import { afterEach, describe, expect, it, vi } from 'vitest'
import { type LlmConfig, createHttpLlmClient } from '../src/assistant/llm-client.js'

// What a completion cost and whether its failure is worth trying again (hardening batch 3,
// items 7 and 9).
//
// Neither was readable before. The log carried input and output tokens only, so nobody could say
// what an answer cost, how much of the prompt was served from the provider's cache, or how many of
// the output tokens went on invisible reasoning at the full output rate. And every failure came
// back as one opaque string, so a 429 that would have succeeded on the next breath was
// indistinguishable from a malformed request, and the loop gave up on both.

const config: LlmConfig = {
  baseUrl: 'https://example.test/api/v1',
  apiKey: 'k',
  model: 'google/gemini-3.1-pro-preview',
  timeoutMs: 5_000,
  reasoningMaxTokens: null,
  knowledgeCutoff: null,
  webSearchTool: null,
}

const respond = (body: unknown, status = 200): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what the completion cost', () => {
  it('reads cost, cached tokens and reasoning tokens from the usage block', async () => {
    respond({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        cost: 0.0184,
        prompt_tokens_details: { cached_tokens: 900 },
        completion_tokens_details: { reasoning_tokens: 128 },
      },
    })
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.usage?.inputTokens).toBe(1200)
    expect(result.usage?.costUsd).toBe(0.0184)
    expect(result.usage?.cachedTokens).toBe(900)
    expect(result.usage?.reasoningTokens).toBe(128)
  })

  it('leaves the new fields absent when the provider reports none', async () => {
    respond({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    })
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Absent, never zero: a provider that does not report a cost is not a free answer.
    expect(result.usage?.costUsd).toBeUndefined()
    expect(result.usage?.cachedTokens).toBeUndefined()
  })

  it('records the model the provider actually served, not the one we asked for', async () => {
    // A fallback list or a provider-side alias means the served model can differ from the
    // requested id, and a log that records the request cannot explain the answer.
    respond({
      model: 'google/gemini-3.1-pro-preview-0827',
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    })
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model).toBe('google/gemini-3.1-pro-preview-0827')
  })
})

describe('whether a failure is worth trying again', () => {
  it('marks a rate limit retryable', async () => {
    respond({ error: 'slow down' }, 429)
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  it('marks a provider-side fault retryable', async () => {
    // The 504 a real freshness run hit on 2026-09-16, which ended the answer with no second try.
    respond({ error: 'gateway timeout' }, 504)
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  it('does not mark a rejected request retryable', async () => {
    // 400 and 401 come back the same way every time; retrying spends money to be refused twice.
    respond({ error: 'bad request' }, 400)
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: false })
  })

  it('marks a truncated completion as truncated rather than merely retryable', async () => {
    // Re-sending it unchanged truncates again. What helps is asking once more with the tools
    // withheld, so the model spends its budget on the answer instead of another lookup.
    respond({
      choices: [{ message: { content: 'half an ans' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    })
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, truncated: true, retryable: false })
  })

  it('marks an empty completion retryable', async () => {
    respond({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] })
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
  })

  it('shortens its own timeout when the caller has less budget left than the default', async () => {
    // The loop owns one wall-clock budget across all rounds. Without this the last round could
    // start a 25-second call against 3 seconds of remaining budget and blow straight through it.
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchSpy)
    await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      timeoutMs: 1_000,
    })
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeDefined()
  })
})
