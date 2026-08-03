import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_TOKENS,
  REPLAYED_TURNS,
  assembleGrounding,
  buildGuardrailSystemPrompt,
  buildLlmMessages,
} from '../src/assistant/grounding.js'
import type { MessageRow } from '../src/assistant/thread-repository.js'

// Unit coverage for the pure grounding-and-prompt assembly (#91): the token budget, the
// keyword/title fallback, the bilingual anti-fabrication guardrail, and the history replay. These
// are the seams the integration suite drives end-to-end through a fake LLM; here they are exercised
// directly so the budget and fallback logic is pinned without a Postgres or a model round-trip. No
// assertion pins the guardrail's exact wording — only its structural properties.

const doc = (title: string, content: string | null) => ({ title, content })

const message = (role: 'user' | 'agent', content: string, seconds: number): MessageRow => ({
  id: `id-${role}-${seconds}`,
  role,
  content,
  createdAt: new Date(`2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`),
})

describe('assembleGrounding (#91)', () => {
  it('injects the whole small corpus when it fits the budget, titled and in order', () => {
    const grounding = assembleGrounding(
      [doc('Closing the grill', 'Turn off the gas valve.'), doc('Refunds', 'Ask a manager.')],
      'how do I close the grill?',
    )
    expect(grounding).toContain('## Closing the grill')
    expect(grounding).toContain('Turn off the gas valve.')
    expect(grounding).toContain('## Refunds')
    // A comfortably-under-budget corpus keeps its authored order.
    expect(grounding.indexOf('Closing the grill')).toBeLessThan(grounding.indexOf('Refunds'))
  })

  it('excludes skipped/blank docs, which carry no groundable content', () => {
    const grounding = assembleGrounding(
      [
        doc('Scanned poster', null),
        doc('Whitespace', '   '),
        doc('Real', 'Actual procedure text.'),
      ],
      'anything',
    )
    expect(grounding).toBe('## Real\nActual procedure text.')
  })

  it('returns an empty block for an empty corpus (the guardrail turns this into "no procedure")', () => {
    expect(assembleGrounding([], 'anything')).toBe('')
    expect(assembleGrounding([doc('Only skipped', null)], 'anything')).toBe('')
  })

  it('falls back to keyword/title relevance when the corpus outgrows the budget', () => {
    // A budget that fits only the single most-relevant doc (~20 tokens each), so the ranking path
    // packs the grill doc and leaves no room for the rest — their sum is far over budget.
    const budget = 24
    const docs = [
      doc('Payroll', 'Payroll runs on the fifth of the month for all staff.'),
      doc('Grill shutdown', 'To close the grill turn off the gas valve and scrape the plate.'),
      doc('Uniforms', 'Uniforms are washed weekly and stored in the back room.'),
    ]
    const grounding = assembleGrounding(docs, 'how do I close the grill safely?', budget)
    // The grill doc shares the most words with the question, so it is selected over the others.
    expect(grounding).toContain('Grill shutdown')
    expect(grounding).not.toContain('Payroll')
    expect(grounding).not.toContain('Uniforms')
  })

  it('still grounds on the single most-relevant doc when even that one exceeds the budget', () => {
    const grounding = assembleGrounding(
      [doc('Long grill procedure', 'gas valve '.repeat(200)), doc('Payroll', 'fifth of the month')],
      'grill gas valve',
      5,
    )
    expect(grounding).toContain('Long grill procedure')
  })
})

describe('buildGuardrailSystemPrompt (#91)', () => {
  it('embeds the grounding and names no source when procedures are present', () => {
    const prompt = buildGuardrailSystemPrompt('## Closing the grill\nTurn off the gas valve.')
    expect(prompt).toContain('Turn off the gas valve.')
    // It instructs against citing sources and against fabricating — structural, not verbatim.
    expect(prompt.toLowerCase()).toContain('only')
    expect(prompt.toLowerCase()).toContain('language')
  })

  it('states there are no procedures when the grounding is empty', () => {
    const prompt = buildGuardrailSystemPrompt('')
    expect(prompt.toLowerCase()).toContain('no procedures')
  })
})

describe('buildLlmMessages (#91)', () => {
  it('leads with the system guardrail, replays history, and appends the new question last', () => {
    const history: MessageRow[] = [
      message('user', 'first question', 1),
      message('agent', 'first answer', 2),
    ]
    const messages = buildLlmMessages('## Doc\ntext', history, 'the new question')

    expect(messages[0]?.role).toBe('system')
    // An `agent` turn is replayed as the wire role `assistant`; a `user` turn stays `user`.
    expect(messages.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant'])
    const last = messages.at(-1)
    expect(last).toEqual({ role: 'user', content: 'the new question' })
  })

  it('replays at most REPLAYED_TURNS prior turns, keeping the most recent', () => {
    const history: MessageRow[] = Array.from({ length: REPLAYED_TURNS + 6 }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'agent', `turn ${i}`, i),
    )
    const messages = buildLlmMessages('', history, 'newest')
    // system + REPLAYED_TURNS replayed + the new question.
    expect(messages).toHaveLength(REPLAYED_TURNS + 2)
    // The oldest turns are dropped; the last replayed turn is the newest of the history.
    const replayed = messages.slice(1, -1)
    expect(replayed[0]?.content).toBe(`turn ${history.length - REPLAYED_TURNS}`)
    expect(replayed.at(-1)?.content).toBe(`turn ${history.length - 1}`)
  })

  it('pins the answer budget to ~800 max tokens', () => {
    expect(ANSWER_MAX_TOKENS).toBe(800)
  })
})
