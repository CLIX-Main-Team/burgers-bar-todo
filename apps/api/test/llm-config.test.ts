import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type LlmConfigEnv,
  createHttpLlmClient,
  resolveLlmConfig,
} from '../src/assistant/llm-client.js'

// Unit coverage for the boot-time provider switch (#91, ADR-0018): resolveLlmConfig picks the
// preset, applies the ASSISTANT_MODEL override, and fails fast when the selected provider's key is
// missing; createHttpLlmClient issues the one OpenAI-compatible POST with the right endpoint,
// headers, and body, and folds every failure to a retryable result. The provider switch is the
// boot-time contract AC-5 names, validated here directly rather than through a booted server.

const baseEnv: LlmConfigEnv = {
  ASSISTANT_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'or-key',
  APP_BASE_URL: 'https://app.example',
}

describe('resolveLlmConfig — boot-time provider switch (#91, ADR-0018)', () => {
  it('defaults to the openrouter preset with its model and attribution headers', () => {
    const config = resolveLlmConfig(baseEnv)
    expect(config.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(config.model).toBe('google/gemini-2.5-flash')
    expect(config.apiKey).toBe('or-key')
    expect(config.attribution).toEqual({ referer: 'https://app.example', title: 'Burgers Bar' })
  })

  it('selects native Gemini with its own endpoint, model, key, and no attribution headers', () => {
    const config = resolveLlmConfig({
      ASSISTANT_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gm-key',
      APP_BASE_URL: 'https://app.example',
    })
    expect(config.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(config.model).toBe('gemini-2.5-flash')
    expect(config.apiKey).toBe('gm-key')
    expect(config.attribution).toBeNull()
  })

  it('lets ASSISTANT_MODEL override the preset default', () => {
    const config = resolveLlmConfig({ ...baseEnv, ASSISTANT_MODEL: 'anthropic/claude-haiku-4.5' })
    expect(config.model).toBe('anthropic/claude-haiku-4.5')
  })

  it('fails fast when the selected provider key is missing', () => {
    expect(() => resolveLlmConfig({ ASSISTANT_PROVIDER: 'openrouter', APP_BASE_URL: 'x' })).toThrow(
      /OPENROUTER_API_KEY/,
    )
    expect(() => resolveLlmConfig({ ASSISTANT_PROVIDER: 'gemini', APP_BASE_URL: 'x' })).toThrow(
      /GEMINI_API_KEY/,
    )
  })

  it('requires the SELECTED provider key even when the other provider key is set', () => {
    // gemini is live but only the openrouter key is present — a switch, not a fallback (ADR-0018).
    expect(() =>
      resolveLlmConfig({
        ASSISTANT_PROVIDER: 'gemini',
        OPENROUTER_API_KEY: 'or-key',
        APP_BASE_URL: 'x',
      }),
    ).toThrow(/GEMINI_API_KEY/)
  })
})

describe('createHttpLlmClient — one OpenAI-compatible fetch (#91)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const okResponse = (content: string) =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    }) as Response

  it('POSTs to the openrouter endpoint with the bearer and attribution headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('the answer'))
    const client = createHttpLlmClient(resolveLlmConfig(baseEnv))

    const result = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 800,
    })

    expect(result).toEqual({ ok: true, content: 'the answer' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer or-key')
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('Burgers Bar')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'google/gemini-2.5-flash', max_tokens: 800 })
  })

  it('sends no attribution headers on the gemini endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse('answer'))
    const client = createHttpLlmClient(
      resolveLlmConfig({ ASSISTANT_PROVIDER: 'gemini', GEMINI_API_KEY: 'gm', APP_BASE_URL: 'x' }),
    )

    await client.complete({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 800 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBeUndefined()
    expect(headers['X-Title']).toBeUndefined()
  })

  it('folds a non-2xx, an empty completion, and a thrown fetch into retryable failures', async () => {
    const client = createHttpLlmClient(resolveLlmConfig(baseEnv))
    const request = { messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 800 }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 502 } as Response)
    expect(await client.complete(request)).toMatchObject({ ok: false })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse('   '))
    expect(await client.complete(request)).toMatchObject({ ok: false })

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'))
    expect(await client.complete(request)).toMatchObject({ ok: false })
  })
})
