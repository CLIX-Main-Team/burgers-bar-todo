import { describe, expect, it } from 'vitest'
import { type LlmMessage, type LlmTool, createFakeLlmClient } from '../src/assistant/llm-client.js'
import {
  type AssistantTool,
  type DraftForReview,
  type ToolOutcome,
  runToolLoop,
} from '../src/assistant/tool-loop.js'
import { createMutableClock } from '../src/auth/clock.js'

// The review pass on a finished draft (2026-09-17). The loop hands every final answer to an
// optional reviewer before returning it; a reviewer that objects gets the draft sent back to the
// model once, with its instruction, under the same budget, caps and trace as the rest of the
// answer. The reviewer here is a stub that objects to a marker word: what a real reviewer looks
// for is source-guard's business and is tested there.

const clock = () => createMutableClock(new Date('2026-09-17T10:00:00.000Z'))

const INSTRUCTION = 'REVIEW: you named a site you never opened'

const objectTo =
  (marker: string, seen: DraftForReview[] = []) =>
  (draft: DraftForReview): string | null => {
    seen.push(draft)
    return draft.content.includes(marker) ? INSTRUCTION : null
  }

const webSearch: LlmTool = { kind: 'server', type: 'openrouter:web_search' }

const tool = (
  name: string,
  run: () => ToolOutcome = () => ({ status: 'ok', content: 'a result', sources: [] }),
): AssistantTool => ({
  definition: {
    kind: 'function',
    name,
    description: `The ${name} tool.`,
    parameters: { type: 'object', properties: {} },
  },
  label: { en: name, he: name },
  run: async () => run(),
})

const question: LlmMessage[] = [
  { role: 'system', content: 'the prompt' },
  { role: 'user', content: 'what is the minimum wage?' },
]

describe('runToolLoop: the review pass', () => {
  it('sends a draft the reviewer objects to back once, and returns the second draft', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      request.messages.some((message) => message.content === INSTRUCTION)
        ? { ok: true, content: 'second draft, from general knowledge' }
        : { ok: true, content: 'first draft, according to BADSITE' },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [tool('search_documents')],
      serverTools: [webSearch],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('second draft, from general knowledge')
    expect(outcome.review).toBe('repaired')
    expect(outcome.rounds).toBe(2)
    expect(llm.requests).toHaveLength(2)
    // The second call replays the draft as the model's own turn, then the instruction, and still
    // offers the tools: the whole point of asking again is that the model can search this time.
    const second = llm.requests[1]
    expect(second?.messages.slice(-2)).toEqual([
      { role: 'assistant', content: 'first draft, according to BADSITE' },
      { role: 'user', content: INSTRUCTION },
    ])
    expect(second?.tools?.map((offered) => offered.kind)).toEqual(['function', 'server'])
  })

  it('returns a clean draft as it always did, with no review verdict on it', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith(() => ({ ok: true, content: 'a clean answer' }))
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('a clean answer')
    expect(outcome.review).toBeUndefined()
    expect(llm.requests).toHaveLength(1)
  })

  it('never sends a draft back twice', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      return { ok: true, content: `draft ${calls}, according to BADSITE` }
    })
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('draft 2, according to BADSITE')
    expect(outcome.review).toBe('unrepaired')
    expect(llm.requests).toHaveLength(2)
  })

  it('keeps the first draft when the second pass fails, because a flawed answer beats none', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      request.messages.some((message) => message.content === INSTRUCTION)
        ? { ok: false, error: 'llm: timeout' }
        : {
            ok: true,
            content: 'first draft, according to BADSITE',
            model: 'google/gemini-3.1-pro-preview',
            usage: { inputTokens: 100, outputTokens: 20 },
          },
    )
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('a failed second pass must not lose the answer')
    expect(outcome.content).toBe('first draft, according to BADSITE')
    expect(outcome.review).toBe('unrepaired')
    expect(outcome.model).toBe('google/gemini-3.1-pro-preview')
    expect(outcome.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 })
  })

  it('does not start a second pass the time budget cannot pay for', async () => {
    const llm = createFakeLlmClient()
    const time = clock()
    llm.respondWith(() => {
      // One slow round: 25 of the 40 seconds are gone, and another like it would not fit.
      time.advance(25_000)
      return { ok: true, content: 'slow draft, according to BADSITE' }
    })
    const outcome = await runToolLoop({
      llm,
      clock: time,
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('slow draft, according to BADSITE')
    expect(outcome.review).toBe('unrepaired')
    expect(llm.requests).toHaveLength(1)
  })

  it('shows the reviewer what the model saw, and never its own instruction or the rejected draft', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) => {
      const sawInstruction = request.messages.some((message) => message.content === INSTRUCTION)
      const sawTool = request.messages.some((message) => message.role === 'tool')
      if (!sawInstruction) return { ok: true, content: 'first draft, according to BADSITE' }
      if (!sawTool) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{}' }],
        }
      }
      return { ok: true, content: 'second draft, still according to BADSITE' }
    })
    const seen: DraftForReview[] = []
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [tool('search_documents')],
      maxTokens: 500,
      review: objectTo('BADSITE', seen),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.review).toBe('unrepaired')
    expect(seen).toHaveLength(2)
    const secondLook = seen[1] as DraftForReview
    const shown = secondLook.messages.map((message) => message.content)
    // If the instruction counted as material, the site it quotes would "back" the very claim it
    // was written to reject, and the second draft would always pass.
    expect(shown).not.toContain(INSTRUCTION)
    expect(shown).not.toContain('first draft, according to BADSITE')
    // What the second pass looked up is material, and is there.
    expect(secondLook.messages.some((message) => message.role === 'tool')).toBe(true)
    expect(secondLook.trace.map((entry) => entry.tool)).toEqual(['search_documents'])
  })

  it('counts the rounds so far when deciding whether a second pass fits the budget', async () => {
    const llm = createFakeLlmClient()
    const time = clock()
    llm.respondWith((request) => {
      // Two rounds of twelve seconds each: 24 spent, one more of the same size fits in 40.
      time.advance(12_000)
      if (request.messages.some((message) => message.content === INSTRUCTION)) {
        return { ok: true, content: 'second draft, from general knowledge' }
      }
      return request.messages.some((message) => message.role === 'tool')
        ? { ok: true, content: 'first draft, according to BADSITE' }
        : {
            ok: true,
            content: '',
            toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{}' }],
          }
    })
    const outcome = await runToolLoop({
      llm,
      clock: time,
      fence: 'f',
      messages: question,
      tools: [tool('search_documents')],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.review).toBe('repaired')
    expect(llm.requests).toHaveLength(3)
  })

  it("returns the rejected draft with the provenance it was written from, not the second pass's", async () => {
    // The chips under an answer come from the trace and the citations. A first draft handed
    // back with pages the second pass found would sit under chips it never used, beside a note
    // saying no website was opened.
    const llm = createFakeLlmClient()
    llm.respondWith((request) => {
      const sentBack = request.messages.some((message) => message.content === INSTRUCTION)
      const sawTool = request.messages.some((message) => message.role === 'tool')
      if (!sentBack) return { ok: true, content: 'first draft, according to BADSITE' }
      if (!sawTool) {
        return {
          ok: true,
          content: '',
          toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{}' }],
          citations: [{ url: 'https://www.kolzchut.org.il/he/wage', title: 'Minimum wage' }],
        }
      }
      return { ok: false, error: 'llm: timeout' }
    })
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [tool('search_documents')],
      serverTools: [webSearch],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected the first draft')
    expect(outcome.content).toBe('first draft, according to BADSITE')
    expect(outcome.review).toBe('unrepaired')
    expect(outcome.citations).toEqual([])
    expect(outcome.trace).toEqual([])
  })

  it('does not call a repaired answer capped because its extra round ran past the round cap', async () => {
    const llm = createFakeLlmClient()
    let lookups = 0
    llm.respondWith((request) => {
      if (request.messages.some((message) => message.content === INSTRUCTION)) {
        return { ok: true, content: 'second draft, from general knowledge' }
      }
      if (lookups < 3) {
        lookups += 1
        return {
          ok: true,
          content: '',
          toolCalls: [
            { id: `c${lookups}`, name: 'search_documents', arguments: `{"q":${lookups}}` },
          ],
        }
      }
      return { ok: true, content: 'fourth round draft, according to BADSITE' }
    })
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [tool('search_documents')],
      maxTokens: 500,
      review: objectTo('BADSITE'),
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.review).toBe('repaired')
    expect(outcome.rounds).toBe(5)
    // The draft that gathered the material had its tools; only the rewrite ran without them.
    expect(outcome.capped).toBe(false)
  })

  it('accepts the draft when the reviewer itself throws, rather than losing the answer', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith(() => ({ ok: true, content: 'an answer' }))
    const outcome = await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: () => {
        throw new Error('a bug in the reviewer')
      },
    })
    if (!outcome.ok) throw new Error('expected an answer')
    expect(outcome.content).toBe('an answer')
    expect(outcome.review).toBeUndefined()
  })

  it('tells the reviewer whether a search ran and whether one can still run', async () => {
    const llm = createFakeLlmClient()
    const seen: DraftForReview[] = []
    llm.respondWith(() => ({ ok: true, content: 'an answer' }))
    await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      serverTools: [webSearch],
      maxTokens: 500,
      review: objectTo('BADSITE', seen),
    })
    expect(seen[0]).toMatchObject({ webSearched: false, canSearch: true })

    seen.length = 0
    llm.respondWith(() => ({
      ok: true,
      content: 'an answer with a page behind it',
      citations: [{ url: 'https://www.kolzchut.org.il/he/wage', title: 'Minimum wage' }],
    }))
    await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      serverTools: [webSearch],
      maxTokens: 500,
      review: objectTo('BADSITE', seen),
    })
    expect(seen[0]).toMatchObject({ webSearched: true })

    seen.length = 0
    llm.respondWith(() => ({ ok: true, content: 'an answer' }))
    await runToolLoop({
      llm,
      clock: clock(),
      fence: 'f',
      messages: question,
      tools: [],
      maxTokens: 500,
      review: objectTo('BADSITE', seen),
    })
    expect(seen[0]).toMatchObject({ webSearched: false, canSearch: false })
  })
})
