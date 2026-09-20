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
  backupModel: null,
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

// Which provider may serve a request that carries the built-in web search (found 2026-09-17 by
// the first full routing run). OpenRouter routes this model to two provider families. Google
// Vertex accepts the built-in web search alongside our function tools; Google AI Studio rejects
// the pair outright with "Please enable tool_config.include_server_side_tool_invocations to use
// Built-in tools with Function calling", a 400 that no retry can help.
//
// Production only ever worked because routing usually lands on Vertex. It falls through to AI
// Studio exactly when Vertex wobbles, which is how a 504 on Vertex turned into a hard 400 and lost
// the answer. Verified against the live API three ways: unpinned 200, ai-studio 400, vertex 200.
describe('which provider may serve a request carrying the built-in web search', () => {
  const sentBody = async (): Promise<Record<string, unknown>> => {
    const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    const init = mock.mock.calls[0]?.[1] as { body: string }
    return JSON.parse(init.body) as Record<string, unknown>
  }

  const webSearch = {
    kind: 'server',
    type: 'openrouter:web_search',
    parameters: { engine: 'native', max_results: 3, max_uses: 2 },
  } as const

  const lookup = {
    kind: 'function',
    name: 'search_documents',
    description: 'search the knowledge base',
    parameters: { type: 'object', properties: {} },
  } as const

  it('pins the request to Vertex when the built-in web search rides along', async () => {
    respond({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    const client = createHttpLlmClient(config)
    await client.complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [lookup, webSearch],
    })
    expect(await sentBody()).toMatchObject({ provider: { only: ['google-vertex'] } })
  })

  // The pin exists because Google AI Studio refuses the pair. It must not follow the request to a
  // model Google does not serve: pinning an Anthropic model to google-vertex leaves OpenRouter with
  // no provider at all. Caught while probing Sonnet as a primary model (2026-09-17), which is a
  // live option precisely because the routed Gemini is a preview with a published shutdown date.
  it('does not pin a non-Google model to a Google provider', async () => {
    respond({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    const client = createHttpLlmClient({ ...config, model: 'anthropic/claude-sonnet-5' })
    await client.complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [lookup, webSearch],
    })
    expect(await sentBody()).not.toHaveProperty('provider')
  })

  // The pin exists only because Google's own engine runs inside Google's provider. Exa runs on the
  // broker's side and reaches the model as plain text, so any provider may serve it, and pinning
  // would only throw away the redundancy (2026-09-18).
  it('does not pin when the search runs on Exa rather than on the Google engine', async () => {
    respond({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    const client = createHttpLlmClient(config)
    await client.complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [lookup, { ...webSearch, parameters: { ...webSearch.parameters, engine: 'exa' } }],
    })
    expect(await sentBody()).not.toHaveProperty('provider')
  })

  it('leaves routing alone when only our own function tools are offered', async () => {
    respond({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    const client = createHttpLlmClient(config)
    await client.complete({
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 100,
      tools: [lookup],
    })
    expect(await sentBody()).not.toHaveProperty('provider')
  })

  it('leaves routing alone when no tools are offered at all', async () => {
    respond({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] })
    const client = createHttpLlmClient(config)
    await client.complete({ messages: [{ role: 'user', content: 'q' }], maxTokens: 100 })
    expect(await sentBody()).not.toHaveProperty('provider')
  })
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

// The backup model (2026-09-20, the owner's call: Sonnet). A 429, a 5xx or a timeout on the
// routed Gemini model used to end the answer after one retry of the same model on the same
// provider, which is exactly the provider having a bad hour. The same call now goes once more to
// the backup model, inside the same time budget, and the log records which model answered.
describe('the backup model', () => {
  const withBackup: LlmConfig = {
    ...config,
    reasoningMaxTokens: 256,
    backupModel: 'anthropic/claude-sonnet-5',
  }
  const ok = {
    choices: [{ message: { content: 'from the backup' } }],
    model: 'anthropic/claude-sonnet-5',
  }
  const sentBodies = (): Record<string, unknown>[] => {
    const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
    return mock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body))
  }

  it('answers from the backup model when the primary is having a bad moment', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'down' }), { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(ok), { status: 200 })),
    )
    const result = await createHttpLlmClient(withBackup).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({
      ok: true,
      content: 'from the backup',
      model: 'anthropic/claude-sonnet-5',
    })
    const [first, second] = sentBodies()
    expect(first?.model).toBe('google/gemini-3.1-pro-preview')
    expect(second?.model).toBe('anthropic/claude-sonnet-5')
    // The reasoning cap is tuned for the primary (256 is below what Anthropic accepts), and the
    // provider pin is Google's; neither rides on the backup call.
    expect(second).not.toHaveProperty('reasoning')
    expect(second).not.toHaveProperty('provider')
  })

  it('does not fall back on a rejected request, which the backup would be refused too', async () => {
    respond({ error: 'bad request' }, 400)
    const result = await createHttpLlmClient(withBackup).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: false })
    expect(sentBodies()).toHaveLength(1)
  })

  it('does not fall back when no backup is configured', async () => {
    respond({ error: 'down' }, 503)
    const result = await createHttpLlmClient(config).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
    expect(sentBodies()).toHaveLength(1)
  })

  it('reports the backup failure, still retryable, when both are down', async () => {
    respond({ error: 'down' }, 503)
    const result = await createHttpLlmClient(withBackup).complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
    })
    expect(result).toMatchObject({ ok: false, retryable: true })
    expect(sentBodies()).toHaveLength(2)
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
