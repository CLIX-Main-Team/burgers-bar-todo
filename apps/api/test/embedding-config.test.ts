import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMBEDDING_DIMENSIONS,
  createFakeEmbeddingClient,
  createHttpEmbeddingClient,
  resolveEmbeddingConfig,
} from '../src/assistant/embedding-client.js'

// The embedding port's boot-time resolution and its one OpenAI-compatible fetch (ADR-0025),
// mirroring llm-config.test.ts: per-provider presets, the override, the no-embeddings provider,
// and the fold-every-failure contract that keeps retrieval degrading to keywords instead of
// erroring.

const baseEnv = {
  ASSISTANT_PROVIDER: 'openrouter' as const,
  OPENROUTER_API_KEY: 'or-key',
  APP_BASE_URL: 'https://app.example',
}

describe('resolveEmbeddingConfig — boot-time resolution (ADR-0025)', () => {
  it('rides the openrouter preset and key with the bake-off default model', () => {
    const config = resolveEmbeddingConfig(baseEnv)
    expect(config).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'qwen/qwen3-embedding-8b',
      apiKey: 'or-key',
    })
  })

  it('selects the native gemini endpoint and key for the gemini provider', () => {
    const config = resolveEmbeddingConfig({
      ASSISTANT_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gm-key',
      APP_BASE_URL: 'x',
    })
    expect(config).toMatchObject({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-embedding-001',
      apiKey: 'gm-key',
    })
  })

  it('resolves to null for groq — no embeddings surface, retrieval stays keyword-ranked', () => {
    expect(
      resolveEmbeddingConfig({
        ASSISTANT_PROVIDER: 'groq',
        GROQ_API_KEY: 'gq',
        APP_BASE_URL: 'x',
      }),
    ).toBeNull()
  })

  it('lets ASSISTANT_EMBEDDING_MODEL override the preset default', () => {
    const config = resolveEmbeddingConfig({ ...baseEnv, ASSISTANT_EMBEDDING_MODEL: 'custom/embed' })
    expect(config?.model).toBe('custom/embed')
  })
})

describe('createHttpEmbeddingClient — one OpenAI-compatible fetch (ADR-0025)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs the batch with the bearer, model, and truncated dimensions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }),
    } as Response)
    const client = createHttpEmbeddingClient(
      resolveEmbeddingConfig(baseEnv) ??
        (() => {
          throw new Error('config must resolve')
        })(),
    )

    const result = await client.embed(['שלום', 'hello'])
    expect(result).toEqual({
      ok: true,
      vectors: [
        [1, 2],
        [3, 4],
      ],
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer or-key')
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'qwen/qwen3-embedding-8b',
      input: ['שלום', 'hello'],
      dimensions: EMBEDDING_DIMENSIONS,
    })
  })

  it('folds a non-2xx, a malformed batch, and a thrown fetch into { ok: false }', async () => {
    const client = () =>
      createHttpEmbeddingClient({
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'm',
        apiKey: 'k',
        timeoutMs: 1_000,
      })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429 } as Response)
    expect((await client().embed(['a'])).ok).toBe(false)

    // One vector for two inputs: pairing would be wrong, so the whole call folds.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1] }] }),
    } as Response)
    expect((await client().embed(['a', 'b'])).ok).toBe(false)

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    expect((await client().embed(['a'])).ok).toBe(false)
  })

  it('returns instantly with no vectors for an empty input, calling no provider', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const client = createHttpEmbeddingClient({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'm',
      apiKey: 'k',
      timeoutMs: 1_000,
    })
    expect(await client.embed([])).toEqual({ ok: true, vectors: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createFakeEmbeddingClient', () => {
  it('fails unscripted — the posture that lands tests on deterministic keyword retrieval', async () => {
    const fake = createFakeEmbeddingClient()
    const result = await fake.embed(['anything'])
    expect(result.ok).toBe(false)
    expect(fake.requests).toEqual([['anything']])
  })

  it('returns scripted vectors when a responder is set, and resets clean', async () => {
    const fake = createFakeEmbeddingClient()
    fake.respondWith((texts) => ({ ok: true, vectors: texts.map(() => [1, 0]) }))
    expect(await fake.embed(['a', 'b'])).toEqual({
      ok: true,
      vectors: [
        [1, 0],
        [1, 0],
      ],
    })
    fake.reset()
    expect((await fake.embed(['c'])).ok).toBe(false)
    expect(fake.requests).toEqual([['c']])
  })
})
