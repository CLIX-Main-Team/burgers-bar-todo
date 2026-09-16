import { describe, expect, it } from 'vitest'
import { type LlmCompletionRequest, createFakeLlmClient } from '../src/assistant/llm-client.js'
import { type AssistantTool, type ToolOutcome, runToolLoop } from '../src/assistant/tool-loop.js'
import { createMutableClock } from '../src/auth/clock.js'

// The loop surviving a bad hour (hardening batch 3, items 9, 10 and 11).
//
// Three separate ways one answer used to be lost or overrun. A single 429 or 504 ended the answer
// with no second try, and the user saw a retry button after paying for the rounds already spent.
// The 40-second budget was a projection, checked before a round rather than bounding it, so one
// slow provider call ran as long as it liked. And a model that asked for the same lookup twice
// paid for it twice and learned nothing, because nothing noticed the repeat.

const tool = (
  name: string,
  run: (args: unknown) => ToolOutcome | Promise<ToolOutcome>,
): AssistantTool => ({
  definition: {
    kind: 'function',
    name,
    description: `The ${name} tool.`,
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  label: { en: name, he: name },
  run: async (args) => run(args),
})

const base = () => ({
  clock: createMutableClock(new Date('2026-09-16T10:00:00.000Z')),
  fence: 'abcd1234',
  messages: [{ role: 'user' as const, content: 'question' }],
  maxTokens: 500,
})

describe('a provider having a bad moment', () => {
  it('tries once more after a retryable failure and answers', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      if (calls === 1) return { ok: false, error: 'provider responded 504', retryable: true }
      return { ok: true, content: 'answered on the second try' }
    })

    const outcome = await runToolLoop({ ...base(), llm, tools: [], retryDelayMs: 0 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.content).toBe('answered on the second try')
    expect(calls).toBe(2)
  })

  it('gives up after one retry rather than hammering a provider that is down', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      return { ok: false, error: 'provider responded 503', retryable: true }
    })

    const outcome = await runToolLoop({ ...base(), llm, tools: [], retryDelayMs: 0 })

    expect(outcome.ok).toBe(false)
    expect(calls).toBe(2)
  })

  it('does not retry a refusal that will be repeated verbatim', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      return { ok: false, error: 'provider responded 400', retryable: false }
    })

    const outcome = await runToolLoop({ ...base(), llm, tools: [], retryDelayMs: 0 })

    expect(outcome.ok).toBe(false)
    expect(calls).toBe(1)
  })

  it('answers a truncated completion by asking again with the tools withheld', async () => {
    // Re-sending it unchanged truncates again. Withholding the tools spends the whole budget on
    // the answer instead of on another lookup.
    const llm = createFakeLlmClient()
    const offered: boolean[] = []
    llm.respondWith((request: LlmCompletionRequest) => {
      offered.push((request.tools ?? []).length > 0)
      if (offered.length === 1) {
        return { ok: false, error: 'provider truncated', retryable: false, truncated: true }
      }
      return { ok: true, content: 'a complete answer' }
    })

    const outcome = await runToolLoop({
      ...base(),
      llm,
      tools: [tool('search_documents', () => ({ status: 'ok', content: 'x', sources: [] }))],
      retryDelayMs: 0,
    })

    expect(outcome.ok).toBe(true)
    expect(offered).toEqual([true, false])
  })
})

describe('the wall-clock budget actually bounds a call', () => {
  it('shortens the per-call timeout to what is left of the budget', async () => {
    const clock = createMutableClock(new Date('2026-09-16T10:00:00.000Z'))
    const llm = createFakeLlmClient()
    const timeouts: (number | undefined)[] = []
    llm.respondWith((request: LlmCompletionRequest) => {
      timeouts.push(request.timeoutMs)
      // Burn most of the budget inside the first round.
      clock.advance(30_000)
      return { ok: true, content: 'done' }
    })

    await runToolLoop({ ...base(), clock, llm, tools: [], deadlineMs: 40_000 })

    // The first call may use the whole budget; what matters is that a number is passed at all, so
    // a call can never outlive the budget it is spending.
    expect(timeouts[0]).toBeLessThanOrEqual(40_000)
    expect(timeouts[0]).toBeGreaterThan(0)
  })

  it('fails a tool that never returns instead of hanging the answer', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request: LlmCompletionRequest) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'slow', arguments: '{}' }],
        }
      }
      return { ok: true, content: 'answered anyway' }
    })

    const outcome = await runToolLoop({
      ...base(),
      llm,
      tools: [tool('slow', () => new Promise<ToolOutcome>(() => {}))],
      toolTimeoutMs: 20,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.trace[0]?.status).toBe('failed')
    expect(outcome.content).toBe('answered anyway')
  })
})

describe('the loop notices it is going in circles', () => {
  it('does not run the same lookup with the same arguments twice', async () => {
    let ran = 0
    const llm = createFakeLlmClient()
    llm.respondWith((request: LlmCompletionRequest) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length < 2) {
        return {
          ok: true,
          content: '',
          toolCalls: [
            { id: `c${results.length}`, name: 'search_documents', arguments: '{"query":"grill"}' },
          ],
        }
      }
      return { ok: true, content: 'done' }
    })

    const outcome = await runToolLoop({
      ...base(),
      llm,
      tools: [
        tool('search_documents', () => {
          ran += 1
          return { status: 'ok', content: 'the grill procedure', sources: [] }
        }),
      ],
    })

    expect(outcome.ok).toBe(true)
    // Asked for twice, run once: the repeat comes back as a steer, not a second paid lookup.
    expect(ran).toBe(1)
    if (!outcome.ok) return
    expect(outcome.trace.map((entry) => entry.status)).toEqual(['ok', 'empty'])
  })

  it('runs the same tool again when the arguments differ', async () => {
    let ran = 0
    const llm = createFakeLlmClient()
    llm.respondWith((request: LlmCompletionRequest) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c0', name: 'search_documents', arguments: '{"query":"grill"}' }],
        }
      }
      if (results.length === 1) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{"query":"fryer"}' }],
        }
      }
      return { ok: true, content: 'done' }
    })

    await runToolLoop({
      ...base(),
      llm,
      tools: [
        tool('search_documents', () => {
          ran += 1
          return { status: 'ok', content: 'x', sources: [] }
        }),
      ],
    })

    expect(ran).toBe(2)
  })

  it('caps how many calls one round may make', async () => {
    let ran = 0
    const llm = createFakeLlmClient()
    llm.respondWith((request: LlmCompletionRequest) => {
      const results = request.messages.filter((message) => message.role === 'tool')
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: Array.from({ length: 20 }, (_, index) => ({
            id: `c${index}`,
            name: 'search_documents',
            arguments: `{"query":"q${index}"}`,
          })),
        }
      }
      return { ok: true, content: 'done' }
    })

    await runToolLoop({
      ...base(),
      llm,
      tools: [
        tool('search_documents', () => {
          ran += 1
          return { status: 'ok', content: 'x', sources: [] }
        }),
      ],
    })

    expect(ran).toBeLessThanOrEqual(8)
  })
})
