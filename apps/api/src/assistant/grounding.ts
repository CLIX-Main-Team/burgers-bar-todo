import type { MessageSource, Role, TaskPriority, TaskStatus } from '@burgers/shared'
import type { LlmMessage } from './llm-client.js'
import type { MessageRow } from './thread-repository.js'

// The prompt assembly for the answer path (ADR-0003, ADR-0013, ADR-0025): the pure step that
// turns the retrieved grounding, the scoped task list, and a thread's history into the messages
// the LLM is called with. Kept free of I/O so the guardrail wording, the replay window, and the
// citation contract are unit-tested directly, and the answer service is left as thin
// orchestration over the injected ports. (Chunk selection itself lives in retrieval.ts —
// ADR-0025 superseded the whole-doc keyword assembly that used to live here.)

// The answer's max_tokens budget (~4000, ADR-0013): a cap keeps the cost and latency of every call
// bounded, but the original 800 was below a real multi-step procedure's length, so answers were cut
// mid-sentence at the ceiling; 1800 in turn was below an enumerating answer over the ingested
// dashboards PLUS a thinking model's reasoning tokens, which count against the same cap
// (llm-client caps the reasoning share separately). 4000 gives a full dashboard enumeration room
// to finish while staying bounded; a completion that still hits the cap is surfaced as a
// retryable failure (llm-client) rather than persisted half-written.
export const ANSWER_MAX_TOKENS = 4_000

// How many prior turns are replayed to the model for context (~10, ADR-0013). Enough to hold a
// follow-up's thread (story 7) without letting a long thread's history blow the input budget.
export const REPLAYED_TURNS = 10

// The sentinel the guardrail asks the model to lead its citation trailer with, and the token
// extractSources keys off to peel that trailer back off the answer (#227). One constant so the
// instruction and the parser can never drift to different words.
export const SOURCES_PREFIX = 'SOURCES:'

const CHARS_PER_TOKEN = 4

// The scoped-task-context token budget (#92): the cap on how much of the asking user's own task
// list is injected. The list handed to the renderer is already capped to what the principal may see
// (ADR-0007), so this budget only bounds the input size — a user on a very large board still yields
// a bounded block. Estimated with the same coarse chars-per-token ratio; the board order is
// preserved, so the earliest tasks survive the cap.
export const TASK_CONTEXT_TOKEN_BUDGET = 2_000

// One scoped task as the answer path hands it to the renderer (#92): the curated subset of a board
// row the assistant is allowed to reason over. The list is produced by the ADR-0007-scoped read, so
// every task here is already one the asking principal may see — the renderer scopes nothing itself,
// it only formats. Dates in; the renderer stamps the due date as a plain calendar day.
export interface AssistantTaskView {
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: Date | null
  assignees: { displayName: string }[]
}

const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

// Human-readable status labels for the task block — the enum tokens read as procedure jargon to the
// model, so `in_progress` becomes "in progress". Priority is already a plain word and rides as-is.
const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  done: 'done',
}

// Render one scoped task as a single compact line the guardrail prompt injects. Assignees and the
// due date are rendered as "unassigned" / "no due date" when absent, so an empty field never reads
// as a fabricated value. The due date is a calendar day (the time-of-day is noise for a shift task).
const renderTask = (task: AssistantTaskView): string => {
  const due = task.dueDate ? task.dueDate.toISOString().slice(0, 10) : 'no due date'
  const assignees =
    task.assignees.length > 0
      ? task.assignees.map((assignee) => assignee.displayName).join(', ')
      : 'unassigned'
  return `- ${task.title} (status: ${STATUS_LABELS[task.status]}, priority: ${task.priority}, due: ${due}, assigned to: ${assignees})`
}

// The line appended when the scoped list is truncated by the budget (#92): it tells the model the
// list it was given is partial, so it never reports the shown tasks as the caller's *complete* set.
// These omitted tasks are the caller's own in-scope tasks — the cut is for prompt size, never a scope
// decision — so disclosing "there are more" leaks nothing across the ADR-0007 boundary; it only keeps
// the answer honest about completeness.
const TASK_TRUNCATION_NOTICE = '- (more of your tasks are not shown here; this list is incomplete)'

// Assemble the scoped task-context block from the principal's already-scoped task list (#92), capped
// at the token budget. The list is injected in the order it arrives (the board's manual order), so
// the earliest tasks survive when the budget bites; when it does, a truncation notice is appended so
// the model never treats the shown tasks as the whole set. An empty list yields an empty block, which
// the guardrail turns into an honest "no tasks are visible to you" — never an implication that tasks
// exist beyond what the scope admits.
export function renderTaskContext(
  tasks: AssistantTaskView[],
  budget: number = TASK_CONTEXT_TOKEN_BUDGET,
): string {
  if (tasks.length === 0) {
    return ''
  }
  const selected: string[] = []
  let remaining = budget
  let truncated = false
  for (const task of tasks) {
    const line = renderTask(task)
    const tokens = estimateTokens(line)
    if (tokens > remaining) {
      truncated = true
      break
    }
    selected.push(line)
    remaining -= tokens
  }
  if (truncated) {
    selected.push(TASK_TRUNCATION_NOTICE)
  }
  return selected.join('\n')
}

// The per-request context the prompt states outright (ADR-0025): the calendar date the model
// cannot otherwise know (task due dates are absolute, so "what's due today?" is unanswerable
// without it) and the asking user's role, so an answer can speak to the right altitude without
// guessing. Both come from the answer service — the clock and the resolved principal — never
// from a client field.
export interface PromptMeta {
  // e.g. "Wednesday, 2026-08-13" — weekday spelled out so the model never derives it (wrongly).
  today: string
  role: Role
}

// The bilingual anti-fabrication guardrail (ADR-0003, ADR-0007, ADR-0025, #57, #92, #227),
// rewritten for answer quality (2026-08) without moving the policy line #267 settled: every claim
// ABOUT THE CHAIN comes only from the retrieved excerpts and the scoped task list; small talk is
// warm and needs no material; everything else uncovered is declined by naming the assistant's
// scope — in the reply's own words, not a fixed template sentence, which read as canned. What the
// rewrite adds is the conduct that was missing: a persona, today's date and the asker's role, an
// answer-the-covered-part rule (the old prompt declined a question if any part was uncovered),
// follow-up awareness over the replayed history, and Markdown shape guidance. The excerpts are
// pieces of documents (retrieval.ts), so the prompt says so — the model must not present an
// excerpt as a document's entirety. The task block is pre-scoped by the caller (ADR-0007): the
// prompt says it holds only tasks the person may see and forbids reasoning about any task not in
// it — the real boundary is the scoped retrieval; this line only keeps the model from talking
// around it. It deliberately does not claim the block is exhaustive: a large board is truncated
// (renderTaskContext appends a notice), so asserting "these are all your tasks" would be a lie
// the model could parrot. The SOURCES trailer (#227) is unchanged: a machine-read line the answer
// path parses and strips, citing exact excerpt titles so invented citations resolve to nothing.
//
// The absence rules (2026-08 field audit): the model sees a retrieved slice, not the corpus, yet
// it phrased misses as corpus-wide facts — "a daily opening procedure is not in my materials"
// while the corpus held two such documents retrieval had missed. All three unfaithful answers in
// the 44-answer audit were exactly this false-absence shape, so the prompt now (a) forbids
// asserting that something does not exist or is not written, allowing only "I did not find it in
// the material I have right now", and (b) counter-pressures the opposite failure — deflecting a
// question the excerpts DO answer — so honesty about the slice never becomes reflexive deferral.
export function buildGuardrailSystemPrompt(
  grounding: string,
  taskContext: string,
  meta: PromptMeta,
): string {
  const procedures = grounding.length > 0 ? grounding : '(no procedures are available)'
  const tasks = taskContext.length > 0 ? taskContext : '(no tasks are visible to you)'
  return [
    'You are the Burgers Bar assistant — the staff app’s built-in helper for the burger' +
      ' chain’s team. You help with the chain’s procedures and the tasks assigned to' +
      ' the person you are talking to.',
    `Today is ${meta.today}. The person you are talking to is one of the chain’s staff` +
      ` (role: ${meta.role}).`,
    '',
    'Style:',
    '- Reply in the same language the question is written in (Hebrew or English).',
    '- Sound like a helpful colleague: natural, direct, and practical. Phrase every reply for' +
      ' the specific question — never fall back on a stock sentence.',
    '- Format for reading: numbered steps for a procedure, a short list for several items, bold' +
      ' for the key point. Keep a simple answer to a sentence or two.',
    '',
    'Answering:',
    '- The procedure excerpts and the task list below are your ONLY knowledge about Burgers' +
      ' Bar. Never state a chain fact — a procedure, policy, person, branch, price, date, or' +
      ' number — that is not written in them.',
    '- The excerpts are selected pieces of longer documents, chosen for this question. Answer' +
      ' from what they say; do not present an excerpt as the whole document.',
    '- Use the conversation history to understand follow-ups: a question like "and after' +
      ' that?" continues the topic you were just answering, so keep drawing on the same' +
      ' material and what you already said.',
    '- Never contradict an answer you already gave in this thread. If you have just described' +
      ' something from the material, do not then say you cannot find it. When a follow-up asks' +
      ' for more than the excerpts hold, say that what you gave is what the material covers and' +
      ' offer the nearest thing you do have — never that the procedure itself is missing.',
    '- A question the excerpts do answer gets answered — never deflected to the manager or' +
      ' the office when the answer is in front of you.',
    '- If the material covers only part of the question, answer that part and say plainly' +
      ' what it does not cover — suggest asking the branch manager or the office about the' +
      ' rest.',
    '- If it covers none of it, say so in your own words and mention what you can help with' +
      ' (the chain’s procedures and their own tasks). Do not answer from general' +
      ' knowledge — no recipes, trivia, or advice from outside the material, and do not guess.',
    '- You see excerpts selected for this question, not the whole knowledge base. When' +
      ' something is missing from them, say you did not find it in the material you have' +
      ' right now — phrased for the question, never as a stock sentence — and suggest' +
      ' rephrasing or asking the branch manager. Never state that a document, procedure, or' +
      ' detail does not exist or is not written anywhere: you cannot know that.',
    '- A greeting or casual small talk needs no material: reply warmly in one or two' +
      ' sentences and offer to help.',
    '- The task list holds only tasks this person is allowed to see; never reveal, invent, or' +
      ' imply any task that is not shown in it. If the list says it is incomplete, tell them' +
      ' so rather than presenting the shown tasks as their complete set.',
    '',
    // The attribution line (#227): the answer path parses this trailer to name the knowledge docs
    // a reply drew on. It is machine-read, never shown — the answer service strips it before the
    // answer is persisted. Exact-title citation lets the path resolve each against a real ingested
    // doc and drop anything invented.
    `After your answer, on a final separate line, write "${SOURCES_PREFIX}" followed by the exact titles of the excerpts your answer used, separated by " | ". Copy each title exactly as it appears after "## ". If your answer used no excerpt — it drew only on the task list, it was a greeting, or you did not have the information — write "${SOURCES_PREFIX} none".`,
    '',
    'Procedure excerpts:',
    procedures,
    '',
    'Tasks assigned to this person:',
    tasks,
  ].join('\n')
}

// Assemble the messages for one answer (ADR-0013): the guardrail-plus-grounding-plus-tasks system
// turn, then the last REPLAYED_TURNS prior turns of the thread in order (an `agent` turn maps to the
// wire role `assistant`), then the new question as the final user turn. The new question is not yet
// in `history` — it is persisted only after a successful answer (ADR-0003) — so it is appended here.
export function buildLlmMessages(
  grounding: string,
  taskContext: string,
  history: MessageRow[],
  question: string,
  meta: PromptMeta,
): LlmMessage[] {
  const recent = history.slice(-REPLAYED_TURNS)
  const replayed: LlmMessage[] = recent.map((turn) => ({
    role: turn.role === 'agent' ? 'assistant' : 'user',
    content: turn.content,
  }))
  return [
    { role: 'system', content: buildGuardrailSystemPrompt(grounding, taskContext, meta) },
    ...replayed,
    { role: 'user', content: question },
  ]
}

// Fold a title to its comparison key: lowercased, its runs of whitespace collapsed to one space,
// trimmed. Matching the model's cited title to an ingested doc on this key tolerates the incidental
// casing/spacing drift a copied title picks up, while staying an exact-title match — never a fuzzy
// or substring one that could credit the wrong doc.
const titleKey = (title: string): string => title.toLowerCase().replace(/\s+/g, ' ').trim()

// Split an answer into its reader-facing text and the knowledge docs it cited (#227). The guardrail
// asks the model to end with a `SOURCES:` trailer naming the procedures its answer used; this is the
// parser half. It reads only the final non-blank line, and only when that line opens with the
// sentinel, so an answer that never emitted a trailer (an older model, a refusal, a stray blank) is
// returned verbatim with no sources rather than mis-parsed. The cited titles are matched against the
// ingested docs the answer was grounded on — so a title the model invented, mangled, or drew from
// nowhere resolves to nothing and is dropped — and the surviving sources are returned in corpus
// order, de-duplicated by id. A task-grounded answer or a refusal cites nothing matchable and yields
// an empty list; the trailer line is always stripped from the returned content, sentinel or not.
export function extractSources(
  raw: string,
  docs: { id: string; title: string }[],
): { content: string; sources: MessageSource[] } {
  const lines = raw.split('\n')
  // Walk back past trailing blank lines to the answer's last line of substance.
  let last = lines.length - 1
  while (last >= 0 && lines[last]?.trim() === '') {
    last -= 1
  }
  const trailer = last >= 0 ? (lines[last] as string).trim() : ''
  // No trailer: the model did not cite (older behaviour, or a stray answer). Return it untouched.
  if (!trailer.toUpperCase().startsWith(SOURCES_PREFIX)) {
    return { content: raw.trim(), sources: [] }
  }

  // Strip the trailer line and re-trim; the answer proper is everything above it.
  const content = lines.slice(0, last).join('\n').trim()
  const cited = new Set(
    trailer
      .slice(SOURCES_PREFIX.length)
      .split('|')
      .map((title) => titleKey(title))
      .filter((key) => key.length > 0),
  )
  // Resolve cited titles to real ingested docs, in corpus order, each doc at most once. "none" (and
  // any title with no ingested match) simply matches nothing, so a source-less answer stays empty.
  const sources: MessageSource[] = []
  const seen = new Set<string>()
  for (const doc of docs) {
    if (cited.has(titleKey(doc.title)) && !seen.has(doc.id)) {
      seen.add(doc.id)
      sources.push({ id: doc.id, title: doc.title })
    }
  }
  return { content, sources }
}
