import { describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/auth/clock.js'
import { type LlmMessage, createFakeLlmClient } from '../src/assistant/llm-client.js'
import { type AssistantTool, type ToolOutcome, runToolLoop } from '../src/assistant/tool-loop.js'

// The bounded tool loop (#381): the model asks for a tool, the loop runs it, hands the result back
// as a fenced tool turn, and repeats until the model answers — under a round cap and one wall-clock
// budget, with every call recorded in a trace the answer path builds provenance from. The model is
// the scriptable fake; the tools are in-memory stubs. Nothing here asserts prompt wording.

const clock = () => createMutableClock(new Date('2026-09-15T10:00:00.000Z'))

const tool = (
  name: string,
  run: (args: unknown) => Promise<ToolOutcome> | ToolOutcome,
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

const toolTurn = (messages: LlmMessage[]) => messages.filter((m) => m.role === 'tool')

describe('runToolLoop (#381)', () => {
  it('runs a requested tool, feeds the fenced result back, and returns the final answer with a trace', async () => {
    const llm = createFakeLlmClient()
    const seen: unknown[] = []
    llm.respondWith((request) => {
      const results = toolTurn(request.messages)
      if (results.length === 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{"query":"פתיחה"}' }],
        }
      }
      // The second round sees the tool result and answers from it.
      return { ok: true, content: `answer from: ${results[0]?.content.includes('GAS VALVE')}` }
    })
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'abcd1234',
      messages: [{ role: 'user', content: 'how do I close?' }],
      tools: [
        tool('search_documents', (args) => {
          seen.push(args)
          return { status: 'ok', content: 'shut the GAS VALVE', sources: [] }
        }),
      ],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('answer from: true')
    expect(seen).toEqual([{ query: 'פתיחה' }])
    expect(outcome.trace).toEqual([
      { tool: 'search_documents', status: 'ok', args: { query: 'פתיחה' }, sources: [] },
    ])
    expect(outcome.rounds).toBe(2)
    // The tool result goes back fenced with the per-call id and the tool's name and status, so the
    // model can tell data from instructions and the server never has to trust its narration.
    const replay = llm.requests.at(-1)?.messages ?? []
    const toolMessage = toolTurn(replay)[0]
    expect(toolMessage?.content).toContain('[TOOL-RESULT abcd1234 search_documents status=ok]')
    expect(toolMessage?.content).toContain('[END-TOOL-RESULT abcd1234]')
    // The assistant turn that requested the tool is replayed with its calls intact.
    const assistantTurn = replay.find((m) => m.role === 'assistant')
    expect(assistantTurn).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'c1' }] })
  })

  it('echoes the provider reasoning details back unmodified on the replayed assistant turn', async () => {
    const llm = createFakeLlmClient()
    const reasoning = [{ type: 'reasoning.encrypted', data: 'opaque' }]
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? {
            ok: true,
            content: '',
            toolCalls: [{ id: 'c1', name: 'noop', arguments: '{}' }],
            reasoningDetails: reasoning,
          }
        : { ok: true, content: 'done' },
    )
    await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('noop', () => ({ status: 'empty', content: '', sources: [] }))],
      maxTokens: 500,
    })
    const assistantTurn = llm.requests.at(-1)?.messages.find((m) => m.role === 'assistant')
    expect(assistantTurn).toMatchObject({ reasoningDetails: reasoning })
  })

  it('runs several calls from one round and answers each by its own id', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? {
            ok: true,
            content: '',
            toolCalls: [
              { id: 'a', name: 'alpha', arguments: '{}' },
              { id: 'b', name: 'beta', arguments: '{}' },
            ],
          }
        : { ok: true, content: 'done' },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] })),
        tool('beta', () => ({ status: 'ok', content: 'B', sources: [] })),
      ],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    const replay = llm.requests.at(-1)?.messages ?? []
    expect(toolTurn(replay).map((m) => (m.role === 'tool' ? m.toolCallId : ''))).toEqual(['a', 'b'])
    expect(outcome.trace.map((t) => t.tool)).toEqual(['alpha', 'beta'])
  })

  it('reports a thrown tool as failed to the model and in the trace, and keeps going', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? { ok: true, content: '', toolCalls: [{ id: 'c1', name: 'broken', arguments: '{}' }] }
        : { ok: true, content: 'answered anyway' },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        tool('broken', () => {
          throw new Error('database down')
        }),
      ],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('answered anyway')
    expect(outcome.trace[0]).toMatchObject({ tool: 'broken', status: 'failed' })
    const toolMessage = toolTurn(llm.requests.at(-1)?.messages ?? [])[0]
    expect(toolMessage?.content).toContain('status=failed')
    // The error class travels to the model so it can say what it could not reach; the message
    // text does not, so a driver's stack trace never becomes prompt material.
    expect(toolMessage?.content).not.toContain('database down')
  })

  it('answers an unknown tool name and malformed arguments as failed calls, never a crash', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? {
            ok: true,
            content: '',
            toolCalls: [
              { id: 'c1', name: 'no_such_tool', arguments: '{}' },
              { id: 'c2', name: 'alpha', arguments: '{not json' },
            ],
          }
        : { ok: true, content: 'done' },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.trace.map((t) => t.status)).toEqual(['failed', 'failed'])
  })

  it('stops after the round cap: the last round is asked to answer without tools', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith((request) => {
      calls += 1
      // A model that asks for a tool every single time it is allowed to.
      if (request.tools && request.tools.length > 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: `c${calls}`, name: 'alpha', arguments: '{}' }],
        }
      }
      return { ok: true, content: 'best effort' }
    })
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
      maxRounds: 3,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('best effort')
    // Three tool rounds, then one final call with the tools withheld.
    expect(calls).toBe(4)
    expect(outcome.trace).toHaveLength(3)
    expect(outcome.capped).toBe(true)
  })

  it('stops when the wall-clock budget is spent, asking for the answer without tools', async () => {
    const llm = createFakeLlmClient()
    const mutable = clock()
    let calls = 0
    llm.respondWith((request) => {
      calls += 1
      // Every model call takes 10 seconds of the budget.
      mutable.advance(10_000)
      if (request.tools && request.tools.length > 0) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: `c${calls}`, name: 'alpha', arguments: '{}' }],
        }
      }
      return { ok: true, content: 'out of time' }
    })
    const outcome = await runToolLoop({
      llm,
      clock: mutable,
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
      maxRounds: 10,
      deadlineMs: 25_000,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('out of time')
    // Two tool rounds fit (20s), the third would breach 25s, so the tools are withheld.
    expect(outcome.trace).toHaveLength(2)
    expect(outcome.capped).toBe(true)
  })

  it('folds a model failure at any round into a failed outcome carrying the trace so far', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? { ok: true, content: '', toolCalls: [{ id: 'c1', name: 'alpha', arguments: '{}' }] }
        : { ok: false, error: 'provider responded 502' },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('expected a failure')
    expect(outcome.error).toBe('provider responded 502')
    expect(outcome.trace).toHaveLength(1)
  })

  it('a model that answers straight away makes one call and leaves an empty trace', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer('hello!')
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'שלום' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('hello!')
    expect(outcome.trace).toEqual([])
    expect(outcome.rounds).toBe(1)
    expect(llm.requests).toHaveLength(1)
  })

  it('sums the provider usage across rounds and carries the citations of the final round', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      toolTurn(request.messages).length === 0
        ? {
            ok: true,
            content: '',
            toolCalls: [{ id: 'c1', name: 'alpha', arguments: '{}' }],
            usage: { inputTokens: 100, outputTokens: 10 },
          }
        : {
            ok: true,
            content: 'done',
            usage: { inputTokens: 200, outputTokens: 20 },
            citations: [{ url: 'https://example.org/a', title: 'A page' }],
          },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: [{ role: 'user', content: 'q' }],
      tools: [tool('alpha', () => ({ status: 'ok', content: 'A', sources: [] }))],
      maxTokens: 500,
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.usage).toEqual({ inputTokens: 300, outputTokens: 30 })
    expect(outcome.citations).toEqual([{ url: 'https://example.org/a', title: 'A page' }])
  })
})
