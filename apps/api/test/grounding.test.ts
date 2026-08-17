import { describe, expect, it } from 'vitest'
import {
  ANSWER_MAX_TOKENS,
  type AssistantTaskView,
  type PromptMeta,
  REPLAYED_TURNS,
  SOURCES_PREFIX,
  buildGuardrailSystemPrompt,
  buildLlmMessages,
  extractSources,
  renderTaskContext,
  takeReplayableHistory,
} from '../src/assistant/grounding.js'
import type { MessageRow } from '../src/assistant/thread-repository.js'

// Unit coverage for the pure prompt assembly (#91, #92, ADR-0025): the bilingual
// anti-fabrication guardrail, the per-request context (date, role), the history replay, and the
// scoped task-context rendering. These are the seams the integration suite drives end-to-end
// through a fake LLM; here they are exercised directly. No assertion pins the guardrail's exact
// wording — only its structural properties. (Chunk selection is covered by retrieval.test.ts;
// the whole-doc assembly these cases used to pin was superseded by ADR-0025.)

const META: PromptMeta = { today: 'Thursday, 2026-01-01', role: 'employee' }

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
  sources: null,
  createdAt: new Date(`2026-01-01T00:00:${String(seconds).padStart(2, '0')}.000Z`),
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

  it('drops completed tasks before spending the budget', () => {
    // A done task answers no question a person asks the assistant, and on a board with months of
    // history the done rows arrive first in board order and pushed the open ones out behind the
    // truncation notice.
    const block = renderTaskContext([
      task({ title: 'Old finished job', status: 'done' }),
      task({ title: 'Still to do', status: 'not_started' }),
    ])
    expect(block).toContain('Still to do')
    expect(block).not.toContain('Old finished job')
  })

  it('renders an empty block when every visible task is done', () => {
    expect(renderTaskContext([task({ title: 'Finished', status: 'done' })])).toBe('')
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

describe('buildGuardrailSystemPrompt (#91, #92, ADR-0025)', () => {
  it('embeds the grounding, pins the model to it, and asks it to cite its sources (#227)', () => {
    const prompt = buildGuardrailSystemPrompt(
      '## Closing the grill\nTurn off the gas valve.',
      '',
      META,
    )
    expect(prompt).toContain('Turn off the gas valve.')
    // It pins chain facts to the provided material and the reply to the question's language —
    // structural, not verbatim.
    expect(prompt.toLowerCase()).toContain('only')
    expect(prompt.toLowerCase()).toContain('language')
    // The citation trailer (#227): the model is asked to name its sources in the machine-read
    // trailer the answer path parses. The sentinel is the seam, asserted structurally.
    expect(prompt).toContain(SOURCES_PREFIX)
  })

  it('states the current date and the asking user’s role (ADR-0025)', () => {
    const prompt = buildGuardrailSystemPrompt('', '', META)
    // Task due dates are absolute, so "what's due today?" is unanswerable unless the prompt
    // says what today is; the role lets the answer speak to the right altitude.
    expect(prompt).toContain('Thursday, 2026-01-01')
    expect(prompt).toContain('employee')
  })

  it('preserves the anti-fabrication rule — decline rather than guess when uncovered (#227)', () => {
    const prompt = buildGuardrailSystemPrompt('', '', META).toLowerCase()
    expect(prompt).toContain('do not guess')
    expect(prompt).toContain('no procedures')
  })

  it('permits small talk but declines everything else uncovered (owner decision, 2026-08)', () => {
    const prompt = buildGuardrailSystemPrompt('', '', META).toLowerCase()
    // Grounded-or-greeting (#267): a greeting gets a warm reply, while an uncovered question is
    // declined with the assistant naming what it covers — never answered from outside knowledge.
    expect(prompt).toContain('small talk')
    expect(prompt).toContain('general')
    expect(prompt).toContain('say so')
  })

  it('asks for the covered part to be answered when material is partial (ADR-0025)', () => {
    const prompt = buildGuardrailSystemPrompt('', '', META).toLowerCase()
    // The old prompt declined a question if ANY part was uncovered; the rewrite instructs the
    // model to answer what the material does cover and name what is missing.
    expect(prompt).toContain('part')
  })

  it('states there are no procedures when the grounding is empty', () => {
    const prompt = buildGuardrailSystemPrompt('', '', META)
    expect(prompt.toLowerCase()).toContain('no procedures')
  })

  it('embeds the scoped task context and states there are no tasks when it is empty', () => {
    const withTasks = buildGuardrailSystemPrompt(
      '',
      '- Close the grill (status: in progress)',
      META,
    )
    expect(withTasks).toContain('Close the grill')
    const withoutTasks = buildGuardrailSystemPrompt('', '', META)
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
    const messages = buildLlmMessages('## Doc\ntext', '', history, 'the new question', META)

    expect(messages[0]?.role).toBe('system')
    // An `agent` turn is replayed as the wire role `assistant`; a `user` turn stays `user`.
    expect(messages.slice(1, -1).map((m) => m.role)).toEqual(['user', 'assistant'])
    const last = messages.at(-1)
    expect(last).toEqual({ role: 'user', content: 'the new question' })
  })

  it('folds the grounding, the task context, and the request context into the system turn', () => {
    const messages = buildLlmMessages(
      '## Closing\nShut the gas valve.',
      '- Close the grill (status: in progress)',
      [],
      'what are my tasks?',
      META,
    )
    const system = messages[0]?.content ?? ''
    expect(system).toContain('Shut the gas valve.')
    expect(system).toContain('Close the grill')
    expect(system).toContain('Thursday, 2026-01-01')
  })

  it('replays at most REPLAYED_TURNS prior turns, keeping the most recent', () => {
    const history: MessageRow[] = Array.from({ length: REPLAYED_TURNS + 6 }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'agent', `turn ${i}`, i),
    )
    const messages = buildLlmMessages('', '', history, 'newest', META)
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

  it('trims replayed history to its token budget, newest first', () => {
    // Ten turns of a full procedure answer is several thousand tokens of input bought on every
    // question, and with the thread reopening automatically a thread never stops growing. Each turn
    // here is ~250 Latin tokens, so the 1,500-token budget admits six of the ten and the six kept
    // are the newest — which is what a follow-up depends on.
    const history: MessageRow[] = Array.from({ length: REPLAYED_TURNS }, (_, i) =>
      message(i % 2 === 0 ? 'user' : 'agent', `turn ${i} `.padEnd(1_000, 'x'), i),
    )
    const kept = takeReplayableHistory(history)
    expect(kept).toHaveLength(6)
    expect(kept.at(-1)?.content).toContain('turn 9')
    expect(kept[0]?.content).toContain('turn 4')
  })

  it('still replays one turn larger than the whole budget', () => {
    // Dropping the immediately preceding turn would break every follow-up, so the newest turn is
    // kept whatever it costs; the budget only decides how much history joins it.
    const history: MessageRow[] = [message('agent', 'x'.repeat(40_000), 0)]
    expect(takeReplayableHistory(history)).toHaveLength(1)
  })

  it('replays a Hebrew turn more expensively than a Latin one of the same length', () => {
    // The budget is measured in tokens, and Hebrew costs roughly twice as many per character. The
    // same character count therefore admits fewer Hebrew turns — which is the whole point of
    // replacing the flat 4-chars-per-token estimate.
    const hebrew = Array.from({ length: REPLAYED_TURNS }, (_, i) =>
      message('user', 'נוהל פתיחת המשמרת בסניף '.repeat(30), i),
    )
    const latin = Array.from({ length: REPLAYED_TURNS }, (_, i) =>
      message('user', 'the shift opening procedure '.repeat(26), i),
    )
    // Comparable character counts, so only the script differs.
    const hebrewChars = hebrew[0]?.content.length ?? 0
    const latinChars = latin[0]?.content.length ?? 0
    expect(Math.abs(hebrewChars - latinChars)).toBeLessThan(40)
    expect(takeReplayableHistory(hebrew).length).toBeLessThan(takeReplayableHistory(latin).length)
  })
})
