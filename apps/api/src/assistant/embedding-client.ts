import type { LlmConfigEnv } from './llm-client.js'

// The embedding port for the retrieval index (ADR-0025): one outbound call that turns texts
// into semantic vectors, behind the same port-and-fake pattern as the LLM client so the sync's
// backfill and the answer path's query embedding are driven by an injected fake in tests and
// never by provider traffic. Embeddings are an enhancement, not a dependency: every failure
// folds to { ok: false } and the caller falls back to keyword ranking over the same chunks, so
// a provider outage degrades retrieval quality rather than availability.

export type EmbedResult = { ok: true; vectors: number[][] } | { ok: false; error: string }

export interface EmbeddingClient {
  // Embed the given texts, in order — vectors[i] belongs to texts[i]. All-or-nothing: a
  // partial provider failure is a failure, so callers never pair vectors with the wrong text.
  embed(texts: string[]): Promise<EmbedResult>
}

// The vector size requested from the provider (Matryoshka truncation). Chosen by a measured
// bake-off (2026-08): at 1024 the cross-language and same-language separation on this corpus was
// as good as the full width at a quarter of the storage, and stable across repeated calls.
export const EMBEDDING_DIMENSIONS = 1_024

// One request's input cap. The backfill embeds a whole corpus in batches of this size; the
// answer path sends one or two query texts.
export const EMBEDDING_BATCH_SIZE = 32

export const EMBEDDING_TIMEOUT_MS = 25_000

// The per-provider default embedding model, mirroring PROVIDER_PRESETS (ADR-0018): the answer
// provider decides which OpenAI-compatible surface serves /embeddings with the same key.
// `qwen3-embedding-8b` won the retrieval bake-off decisively on this bilingual corpus
// (cross-lingual EN-question→HE-doc margins 2–4× wider than gemini-embedding/text-embedding-3,
// and stable across OpenRouter's provider routing, which gemini-embedding was not). Groq serves
// no embeddings endpoint, so the groq preset disables the index and retrieval stays on keyword
// ranking.
const EMBEDDING_MODEL_PRESETS: Record<LlmConfigEnv['ASSISTANT_PROVIDER'], string | null> = {
  openrouter: 'qwen/qwen3-embedding-8b',
  gemini: 'gemini-embedding-001',
  groq: null,
}

const EMBEDDING_BASE_URLS: Record<LlmConfigEnv['ASSISTANT_PROVIDER'], string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: '',
}

export interface EmbeddingConfig {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
}

// The env fields the embedding resolver reads — the LLM's provider/key surface plus the
// optional model override.
export interface EmbeddingConfigEnv extends LlmConfigEnv {
  ASSISTANT_EMBEDDING_MODEL?: string
}

// Resolve the embedding configuration for the selected provider at boot, or null when that
// provider serves no embeddings (groq) — in which case the retrieval index simply stays
// unembedded and grounding ranks by keywords. Unlike the LLM key (resolveLlmConfig), a missing
// key can never happen here: the same key already passed the LLM's fail-fast validation.
export function resolveEmbeddingConfig(
  env: EmbeddingConfigEnv,
  timeoutMs: number = EMBEDDING_TIMEOUT_MS,
): EmbeddingConfig | null {
  const model =
    env.ASSISTANT_EMBEDDING_MODEL?.trim() || EMBEDDING_MODEL_PRESETS[env.ASSISTANT_PROVIDER]
  if (!model) {
    return null
  }
  const apiKeyEnv = env.ASSISTANT_PROVIDER === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'
  const apiKey = env[apiKeyEnv]
  if (!apiKey) {
    return null
  }
  return { baseUrl: EMBEDDING_BASE_URLS[env.ASSISTANT_PROVIDER], model, apiKey, timeoutMs }
}

// The real fetch-backed client: plain POSTs to the provider's OpenAI-compatible /embeddings,
// batched sequentially. Any failure — non-2xx, malformed body, a vector count that does not
// match the input count, timeout — folds the WHOLE call to { ok: false } (ADR-0025: retrieval
// falls back to keywords). Nothing here logs the texts: chunk content and questions are prompt
// material and are never logged (ADR-0011).
export function createHttpEmbeddingClient(config: EmbeddingConfig): EmbeddingClient {
  const endpoint = `${config.baseUrl}/embeddings`
  const embedBatch = async (texts: string[]): Promise<EmbedResult> => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        return { ok: false, error: `embedding provider responded ${res.status}` }
      }
      const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
      const vectors = (data.data ?? []).map((item) => item.embedding ?? [])
      if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
        return { ok: false, error: 'embedding provider returned a malformed batch' }
      }
      return { ok: true, vectors }
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error'
      return { ok: false, error: `embedding request failed: ${reason}` }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    embed: async (texts) => {
      if (texts.length === 0) {
        return { ok: true, vectors: [] }
      }
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
        const result = await embedBatch(texts.slice(start, start + EMBEDDING_BATCH_SIZE))
        if (!result.ok) {
          return result
        }
        vectors.push(...result.vectors)
      }
      return { ok: true, vectors }
    },
  }
}

// The disabled client for a provider with no embeddings surface (groq): every call fails, so
// the index never fills and retrieval stays on keyword ranking — the same graceful path a
// provider outage takes.
export function createDisabledEmbeddingClient(): EmbeddingClient {
  return {
    embed: async () => ({ ok: false, error: 'embeddings are not available for this provider' }),
  }
}

// --- The scriptable fake, living beside the port like the Drive/LLM/clock fakes ---

// By default the fake FAILS, which is the deliberate test posture: integration tests then
// exercise the keyword-ranking path, whose selection is a deterministic function of the text —
// scripted vectors would make grounding depend on invented geometry. A retrieval-specific test
// scripts respondWith to hand back controlled vectors instead.
export interface FakeEmbeddingClient extends EmbeddingClient {
  respondWith(responder: (texts: string[]) => EmbedResult): void
  // Every embed() input, in order — for asserting what was sent to be embedded.
  readonly requests: string[][]
  reset(): void
}

export function createFakeEmbeddingClient(): FakeEmbeddingClient {
  let responder: ((texts: string[]) => EmbedResult) | null = null
  const requests: string[][] = []
  return {
    respondWith: (fn) => {
      responder = fn
    },
    get requests() {
      return requests
    },
    reset: () => {
      responder = null
      requests.length = 0
    },
    embed: async (texts) => {
      requests.push([...texts])
      if (responder) {
        return responder(texts)
      }
      return { ok: false, error: 'fake embeddings: not scripted' }
    },
  }
}
