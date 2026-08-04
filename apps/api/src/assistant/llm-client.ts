// The Assistant's LLM port (ADR-0003, ADR-0013, ADR-0018): the single outbound call the answer
// path makes to a language model, behind one transport-agnostic interface so the answer path, its
// retry, budget, and guardrail wiring are all driven by an injected fake in tests and never by
// real provider traffic. It mirrors how the module injects the Drive client and the clock — one
// port, one real fetch-backed implementation, one scriptable fake below as the test double.
//
// The provider is a boot-time switch, not a runtime fallback (ADR-0018): OpenRouter (default) or
// native Gemini, both reached through the same OpenAI-compatible chat-completions shape lifted from
// the source Clix-CRM `callOpenRouter`. The switch is a preset of {base URL, default model, key
// env, attribution headers} selected once at process start — not a second code path and not a
// vendor SDK. Exactly one provider is live per process; the selected provider's key is validated at
// boot (missing → fail fast, see resolveLlmConfig), so a misconfigured deploy never limps to the
// first answer before failing.

// A chat message in the OpenAI-compatible shape both providers accept. The answer path builds a
// system turn (guardrail + grounding) followed by the replayed history and the new question; a
// thread's `agent` turn maps to the wire role `assistant`.
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// One completion request: the assembled messages and the answer's max_tokens budget (ADR-0013).
export interface LlmCompletionRequest {
  messages: LlmMessage[]
  maxTokens: number
}

// The outcome of a completion, folded to a result rather than a throw: a model failure (timeout,
// non-2xx, malformed or empty body) is an expected, retryable control-flow outcome the answer path
// turns into an inline retry with no persisted row (ADR-0003), not an exception. On success the
// answer text is carried; on failure a short, non-content reason — the error CLASS only, never the
// prompt, the response, or a body that might echo them (ADR-0011).
export type LlmCompletionResult = { ok: true; content: string } | { ok: false; error: string }

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
}

// --- Provider presets and boot-time configuration (ADR-0018) ---

export type AssistantProvider = 'openrouter' | 'gemini' | 'groq'

// The per-provider preset: the OpenAI-compatible base URL, the default routed model, the env var
// carrying the key, and whether OpenRouter's optional attribution headers are sent. ASSISTANT_MODEL
// overrides defaultModel when set (ADR-0013).
interface ProviderPreset {
  baseUrl: string
  defaultModel: string
  apiKeyEnv: 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY'
  sendsAttribution: boolean
}

export const PROVIDER_PRESETS: Record<AssistantProvider, ProviderPreset> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    sendsAttribution: true,
  },
  gemini: {
    // Google's Gemini API reached through its OpenAI-compatible endpoint (ADR-0018), so the one
    // `fetch` shape serves both providers with no vendor SDK. The default is the floating
    // `gemini-flash-latest` alias rather than a pinned generation: Google retires dated Gemini
    // ids for new API keys (the pinned `gemini-2.5-flash` began 404-ing — "no longer available to
    // new users" — and took every answer down with it), and the alias always resolves to a live
    // flash model. Pin a specific generation via ASSISTANT_MODEL when a deploy needs one.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    apiKeyEnv: 'GEMINI_API_KEY',
    sendsAttribution: false,
  },
  groq: {
    // Groq's OpenAI-compatible endpoint (ADR-0022), the same one `fetch` shape as the other two
    // presets — no vendor SDK. Added for its free-tier request headroom: where Gemini's free tier
    // caps at ~10-15 RPM / 250-1,000 RPD (and folds a floor-shift assistant into constant 429s),
    // Groq's free tier gives 30 RPM and far higher daily ceilings. The default is
    // `llama-3.3-70b-versatile` — the best free grounded-instruction-follower on Groq (30 RPM /
    // 1,000 RPD / 12K TPM). For raw daily volume over nuance, pin `llama-3.1-8b-instant`
    // (30 RPM / 14,400 RPD) via ASSISTANT_MODEL. Groq sends no attribution headers.
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
    sendsAttribution: false,
  },
}

// OpenRouter's optional attribution headers (ADR-0013): a referer and a product title for the
// broker's usage rankings. Only the openrouter preset sends them; gemini sends none (ADR-0018).
export interface LlmAttribution {
  referer: string
  title: string
}

// The resolved, ready-to-call configuration: the concrete endpoint, routed model, key, optional
// attribution, and the request timeout. Built once at boot from the env by resolveLlmConfig.
export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  attribution: LlmAttribution | null
  timeoutMs: number
}

// The env fields resolveLlmConfig reads — the already-parsed values env.ts owns the schema for.
// Kept structural (not the whole Env type) so the resolver is unit-testable with a plain object.
export interface LlmConfigEnv {
  ASSISTANT_PROVIDER: AssistantProvider
  ASSISTANT_MODEL?: string
  OPENROUTER_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_API_KEY?: string
  APP_BASE_URL: string
}

// The product title sent as OpenRouter's X-Title attribution header.
const ATTRIBUTION_TITLE = 'Burgers Bar'

// The answer-path request timeout (~25s, ADR-0013): a slow provider becomes an inline retry rather
// than an indefinite hang on a floor shift.
export const LLM_TIMEOUT_MS = 25_000

// A low, fixed sampling temperature for the answer path. A floor-shift answer is a lookup, not a
// creative task: pinning temperature low keeps the SAME question from producing wildly
// different-length completions run-to-run — the run-to-run length variance that made truncation
// against the max_tokens cap intermittent (some runs cleared the cap, some were cut mid-sentence).
export const ANSWER_TEMPERATURE = 0.2

// Resolve the live provider configuration at boot (ADR-0018). Picks the preset for the selected
// provider, applies the ASSISTANT_MODEL override, and reads the selected provider's key — throwing
// when it is missing so a misconfigured deploy fails fast rather than at the first answer. The
// other provider's key may be unset. Attribution is sent only for the openrouter preset.
export function resolveLlmConfig(env: LlmConfigEnv, timeoutMs: number = LLM_TIMEOUT_MS): LlmConfig {
  const preset = PROVIDER_PRESETS[env.ASSISTANT_PROVIDER]
  const apiKey = env[preset.apiKeyEnv]
  if (!apiKey) {
    throw new Error(
      `Assistant provider "${env.ASSISTANT_PROVIDER}" requires ${preset.apiKeyEnv} to be set`,
    )
  }
  const model = env.ASSISTANT_MODEL?.trim() || preset.defaultModel
  return {
    baseUrl: preset.baseUrl,
    model,
    apiKey,
    attribution: preset.sendsAttribution
      ? { referer: env.APP_BASE_URL, title: ATTRIBUTION_TITLE }
      : null,
    timeoutMs,
  }
}

// --- The real fetch-backed client (no vendor SDK) ---

// Build the fetch-backed LlmClient for a resolved config. One plain POST to the provider's
// OpenAI-compatible /chat/completions — the shape both presets share (ADR-0018). Any failure — a
// missing 2xx, a malformed or empty body, an abort past the timeout, a network error — folds to
// { ok: false } so the answer path can retry inline (ADR-0003). Nothing here logs the request or
// the response: prompt, answer, and grounding are never logged (ADR-0011).
export function createHttpLlmClient(config: LlmConfig): LlmClient {
  const endpoint = `${config.baseUrl}/chat/completions`
  return {
    complete: async ({ messages, maxTokens }) => {
      // Abort past the timeout so a slow provider becomes a retry, not an open socket.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        }
        if (config.attribution) {
          headers['HTTP-Referer'] = config.attribution.referer
          headers['X-Title'] = config.attribution.title
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            temperature: ANSWER_TEMPERATURE,
            messages,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          // Carry only the status class — never the response body, which can echo prompt content.
          return { ok: false, error: `provider responded ${res.status}` }
        }
        const data = (await res.json()) as {
          choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
        }
        const choice = data.choices?.[0]
        const content = choice?.message?.content?.trim() ?? ''
        if (content.length === 0) {
          return { ok: false, error: 'provider returned an empty completion' }
        }
        // A "length" finish_reason means the model hit the max_tokens cap and the content is cut
        // mid-sentence (ADR-0013). That is not a good answer — folding it to a retryable failure
        // keeps a truncated turn from being persisted and shown as if it were complete, and lets the
        // answer path retry inline (ADR-0003) rather than storing half a procedure. Carry only the
        // reason class, never the truncated body (ADR-0011).
        if (choice?.finish_reason === 'length') {
          return { ok: false, error: 'provider truncated the completion at the token cap' }
        }
        return { ok: true, content }
      } catch (error) {
        // Timeout (abort) and network errors land here; report the class, not the payload.
        const reason = error instanceof Error ? error.name : 'unknown error'
        return { ok: false, error: `provider request failed: ${reason}` }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

// --- The scriptable fake, the test double the answer-path plan names ---

// A scriptable in-memory LlmClient (living in src beside the port, as the Drive and clock fakes do)
// so the answer path and its tests share one definition. By default it returns a canned answer; a
// test scripts a responder to reflect the assembled grounding — the way the "answers from a
// procedure" and "no procedure for that outside the grounding" cases are proved without real
// traffic and without asserting the prompt string — or forces the next call to fail to drive the
// retry path. It captures each request so a test can assert the budget (max_tokens) and the
// replayed-turn count as external, structural facts, never the guardrail wording.
export interface FakeLlmClient extends LlmClient {
  // The answer returned when no responder is set and no failure is queued.
  setDefaultAnswer(content: string): void
  // Compute the answer from the request — used to reflect grounding (an obedient-model simulation).
  respondWith(responder: (request: LlmCompletionRequest) => LlmCompletionResult): void
  // Force the next complete() to fail (timeout/non-2xx/malformed all fold to this), one-shot: the
  // following call behaves normally, so a test can prove the retry succeeds after a hiccup.
  failNext(error?: string): void
  // Every request complete() was called with, in order — for the budget/history assertions.
  readonly requests: LlmCompletionRequest[]
  reset(): void
}

const DEFAULT_FAKE_ANSWER = 'This is a fake assistant answer.'

export function createFakeLlmClient(): FakeLlmClient {
  let defaultAnswer = DEFAULT_FAKE_ANSWER
  let responder: ((request: LlmCompletionRequest) => LlmCompletionResult) | null = null
  let nextError: string | null = null
  const requests: LlmCompletionRequest[] = []

  return {
    setDefaultAnswer: (content) => {
      defaultAnswer = content
    },
    respondWith: (fn) => {
      responder = fn
    },
    failNext: (error = 'fake llm: forced failure') => {
      nextError = error
    },
    get requests() {
      return requests
    },
    reset: () => {
      defaultAnswer = DEFAULT_FAKE_ANSWER
      responder = null
      nextError = null
      requests.length = 0
    },
    complete: async (request) => {
      // Capture a copy so a later mutation of the caller's array cannot rewrite recorded history.
      requests.push({ messages: [...request.messages], maxTokens: request.maxTokens })
      if (nextError) {
        const error = nextError
        nextError = null
        return { ok: false, error }
      }
      if (responder) {
        return responder(request)
      }
      return { ok: true, content: defaultAnswer }
    },
  }
}
