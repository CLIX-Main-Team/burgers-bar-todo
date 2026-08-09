import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_TOKENS,
  type AssistantTaskView,
  REPLAYED_TURNS,
  SOURCES_PREFIX,
  assembleGrounding,
  buildGuardrailSystemPrompt,
  buildLlmMessages,
  extractSources,
  renderTaskContext,
} from '../src/assistant/grounding.js'
import type { MessageRow } from '../src/assistant/thread-repository.js'

// Unit coverage for the pure grounding-and-prompt assembly (#91, #92): the token budget, the
// keyword/title fallback, the bilingual anti-fabrication guardrail, the history replay, and the
// scoped task-context rendering. These are the seams the integration suite drives end-to-end
// through a fake LLM; here they are exercised directly so the budget and fallback logic is pinned
// without a Postgres or a model round-trip. No assertion pins the guardrail's exact wording — only
// its structural properties.

const doc = (title: string, content: string | null) => ({ title, content })

// A scoped task as the answer path hands it to the renderer (#92): the curated, already-scoped
// subset of a board row. The list the renderer receives has already passed through the ADR-0007
// scope predicate, so rendering is a pure formatting step with no scoping of its own.
const task = (over: Partial<AssistantTaskView> = {}): AssistantTaskView => ({
  title: 'Clean the grill',
  status: 'not_started',
  priority: 'normal',
  dueDate: null,
  assignees: [],
  ...over,
})

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

describe('renderTaskContext (#92)', () => {
  it('renders each scoped task with its status, priority, due date, and assignees', () => {
    const block = renderTaskContext([
      task({
        title: 'Close the grill',
        status: 'in_progress',
        priority: 'high',
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        assignees: [{ displayName: 'Alice' }, { displayName: 'Bob' }],
      }),
    ])
    expect(block).toContain('Close the grill')
    // Status and priority are rendered in a human-readable form, not the raw enum token.
    expect(block).toContain('in progress')
    expect(block).toContain('high')
    expect(block).toContain('2026-02-01')
    expect(block).toContain('Alice')
    expect(block).toContain('Bob')
  })

  it('returns an empty block for an empty scoped list (the guardrail turns this into "no tasks")', () => {
    expect(renderTaskContext([])).toBe('')
  })

  it('marks an unassigned task and a task with no due date without inventing values', () => {
    const block = renderTaskContext([task({ title: 'Backlog item', assignees: [], dueDate: null })])
    expect(block).toContain('Backlog item')
    // No fabricated assignee or date leaks in; the row reads as unassigned / no due date.
    expect(block.toLowerCase()).toContain('unassigned')
  })

  it('caps the rendered block at the token budget and flags the truncation honestly', () => {
    const many = Array.from({ length: 500 }, (_, i) => task({ title: `Task number ${i}` }))
    const block = renderTaskContext(many)
    // A coarse chars-per-token estimate keeps the block within a bounded budget rather than
    // injecting an unbounded list; the earliest tasks (board order) survive the cap.
    expect(block.length).toBeLessThan(500 * 40)
    expect(block).toContain('Task number 0')
    expect(block).not.toContain('Task number 499')
    // When the budget bites, the block says so, so the model never reports the shown tasks as the
    // caller's complete set — the omitted ones are their own in-scope tasks, cut only for size.
    expect(block.toLowerCase()).toContain('incomplete')
  })

  it('appends no truncation notice when the whole scoped list fits', () => {
    const block = renderTaskContext([task({ title: 'Only task' })])
    expect(block).toContain('Only task')
    expect(block.toLowerCase()).not.toContain('incomplete')
  })
})

describe('buildGuardrailSystemPrompt (#91, #92)', () => {
  it('embeds the grounding, pins the model to it, and asks it to cite its sources (#227)', () => {
    const prompt = buildGuardrailSystemPrompt('## Closing the grill\nTurn off the gas valve.', '')
    expect(prompt).toContain('Turn off the gas valve.')
    // It pins the answer to the provided material and to the question's language — structural,
    // not verbatim.
    expect(prompt.toLowerCase()).toContain('only')
    expect(prompt.toLowerCase()).toContain('language')
    // The no-cite guardrail is reversed (#227): the model is now asked to name its sources in the
    // machine-read trailer the answer path parses. The sentinel is the seam, asserted structurally.
    expect(prompt).toContain(SOURCES_PREFIX)
  })

  it('preserves the anti-fabrication rule — refuse rather than guess when uncovered (#227)', () => {
    const prompt = buildGuardrailSystemPrompt('', '').toLowerCase()
    // Reversing the no-cite line must not soften the refuse-when-uncovered guardrail: the model is
    // still told to say it lacks the information and not to guess or invent.
    expect(prompt).toContain('do not guess')
    expect(prompt).toContain('no procedures')
  })

  it('permits small talk but declines everything else uncovered (owner decision, 2026-08)', () => {
    const prompt = buildGuardrailSystemPrompt('', '')
    // Grounded-or-greeting: a greeting gets one warm sentence, while an off-topic question is
    // declined by naming what the assistant covers — never answered from outside knowledge. This
    // pins both halves: the small-talk exception and the steer-to-scope decline.
    expect(prompt.toLowerCase()).toContain('small talk')
    expect(prompt.toLowerCase()).toContain('outside what you can help with')
  })

  it('states there are no procedures when the grounding is empty', () => {
    const prompt = buildGuardrailSystemPrompt('', '')
    expect(prompt.toLowerCase()).toContain('no procedures')
  })

  it('embeds the scoped task context and states there are no tasks when it is empty', () => {
    const withTasks = buildGuardrailSystemPrompt('', '- Close the grill (status: in progress)')
    expect(withTasks).toContain('Close the grill')
    const withoutTasks = buildGuardrailSystemPrompt('', '')
    // With no scoped tasks the model is told so, so it never implies tasks exist beyond the list.
    expect(withoutTasks.toLowerCase()).toContain('no tasks')
  })
})

describe('extractSources (#227)', () => {
  const ingested = [
    { id: 'doc-grill', title: 'Closing the grill' },
    { id: 'doc-refunds', title: 'Refunds' },
  ]

  it('peels the SOURCES trailer off and resolves cited titles to ingested docs', () => {
    const { content, sources } = extractSources(
      `Turn off the gas valve.\n${SOURCES_PREFIX} Closing the grill`,
      ingested,
    )
    // The trailer never reaches the reader — only the answer proper survives.
    expect(content).toBe('Turn off the gas valve.')
    expect(sources).toEqual([{ id: 'doc-grill', title: 'Closing the grill' }])
  })

  it('resolves several cited titles in corpus order, de-duplicated by id', () => {
    const { sources } = extractSources(
      // Cited out of order and with the grill doc named twice; the result is corpus order, once each.
      `An answer.\n${SOURCES_PREFIX} Refunds | Closing the grill | Closing the grill`,
      ingested,
    )
    expect(sources).toEqual([
      { id: 'doc-grill', title: 'Closing the grill' },
      { id: 'doc-refunds', title: 'Refunds' },
    ])
  })

  it('yields no sources for a "none" trailer (a task-grounded answer or refusal), stripping it', () => {
    const { content, sources } = extractSources(
      `Alice is on the grill today.\n${SOURCES_PREFIX} none`,
      ingested,
    )
    expect(content).toBe('Alice is on the grill today.')
    expect(sources).toEqual([])
  })

  it('drops a cited title that matches no ingested doc — an invented source resolves to nothing', () => {
    const { sources } = extractSources(
      `An answer.\n${SOURCES_PREFIX} A procedure that does not exist`,
      ingested,
    )
    expect(sources).toEqual([])
  })

  it('matches titles tolerant of casing and whitespace drift, still an exact-title match', () => {
    const { sources } = extractSources(
      `An answer.\n${SOURCES_PREFIX}   closing   the GRILL `,
      ingested,
    )
    expect(sources).toEqual([{ id: 'doc-grill', title: 'Closing the grill' }])
  })

  it('returns an un-emitted answer verbatim with no sources (older model, no trailer)', () => {
    const { content, sources } = extractSources('A plain answer with no trailer.', ingested)
    expect(content).toBe('A plain answer with no trailer.')
    expect(sources).toEqual([])
  })

  it('reads only the final line as the trailer, so a mid-answer mention is not a citation', () => {
    const answer = `${SOURCES_PREFIX} this looks like a trailer but is the body\nThe real answer.`
    const { content, sources } = extractSources(answer, ingested)
    expect(content).toBe(answer.trim())
    expect(sources).toEqual([])
  })
})

describe('buildLlmMessages (#91, #92)', () => {
  it('leads with the system guardrail, replays history, and appends the new question last', () => {
    const history: MessageRow[] = [
      message('user', 'first question', 1),
      message('agent', 'first answer', 2),
    ]
    const messages = buildLlmMessages('## Doc\ntext', '', history, 'the new question')

    expect(messages[0]?.role).toBe('system')
    // An `agent` turn is replayed as the wire role `assistant`; a `user` turn stays `user`.
    expect(messages.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant'])
    const last = messages.at(-1)
    expect(last).toEqual({ role: 'user', content: 'the new question' })
  })

  it('folds both the procedure grounding and the scoped task context into the system turn', () => {
    const messages = buildLlmMessages(
      '## Closing\nShut the gas valve.',
      '- Close the grill (status: in progress)',
      [],
      'what are my tasks?',
    )
    const system = messages[0]?.content ?? ''
    expect(system).toContain('Shut the gas valve.')
    expect(system).toContain('Close the grill')
  })

  it('replays at most REPLAYED_TURNS prior turns, keeping the most recent', () => {
    const history: MessageRow[] = Array.from({ length: REPLAYED_TURNS + 6 }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'agent', `turn ${i}`, i),
    )
    const messages = buildLlmMessages('', '', history, 'newest')
    // system + REPLAYED_TURNS replayed + the new question.
    expect(messages).toHaveLength(REPLAYED_TURNS + 2)
    // The oldest turns are dropped; the last replayed turn is the newest of the history.
    const replayed = messages.slice(1, -1)
    expect(replayed[0]?.content).toBe(`turn ${history.length - REPLAYED_TURNS}`)
    expect(replayed.at(-1)?.content).toBe(`turn ${history.length - 1}`)
  })

  it('pins the answer budget to ~4000 max tokens', () => {
    expect(ANSWER_MAX_TOKENS).toBe(4_000)
  })
})
