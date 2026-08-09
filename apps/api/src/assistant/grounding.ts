import type { MessageSource, TaskPriority, TaskStatus } from '@burgers/shared'
import type { LlmMessage } from './llm-client.js'
import type { MessageRow } from './thread-repository.js'

// The grounding-and-prompt assembly for the answer path (ADR-0003, ADR-0004, ADR-0013): the pure
// step that turns the knowledge cache and a thread's history into the messages the LLM is called
// with. Kept free of I/O so the token budget, the keyword/title fallback, and the bilingual
// anti-fabrication guardrail are unit-tested directly, and the answer service is left as thin
// orchestration over the injected port.

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

// The grounding token budget: the cap on how much cached procedure text is injected (ADR-0004,
// "inject relevant docs up to a token budget"). Estimated in tokens via a coarse chars-per-token
// ratio — there is no tokenizer on the request path, and the cap only needs to be approximately
// right to keep the input bounded. Per-doc content is already length-capped at ingestion (#88).
export const GROUNDING_TOKEN_BUDGET = 6_000
const CHARS_PER_TOKEN = 4

// The scoped-task-context token budget (#92): the cap on how much of the asking user's own task
// list is injected. The list handed to the renderer is already capped to what the principal may see
// (ADR-0007), so this budget only bounds the input size — a user on a very large board still yields
// a bounded block. Estimated with the same coarse chars-per-token ratio; the board order is
// preserved, so the earliest tasks survive the cap.
export const TASK_CONTEXT_TOKEN_BUDGET = 2_000

// A cached procedure as grounding reads it — just the title and its extracted text. The answer path
// passes the ingested docs; a skipped/near-empty row carries no content and grounds nothing.
export interface GroundingDoc {
  title: string
  content: string | null
}

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

// Render one doc as a titled block for the guardrail prompt to inject.
const renderDoc = (doc: { title: string; content: string }): string =>
  `## ${doc.title}\n${doc.content}`

// Split text into lowercased word tokens for the keyword/title overlap score. Punctuation splits
// words and one/two-letter tokens are dropped so the overlap keys on meaningful terms, bilingually
// (the Unicode letter class covers Hebrew as well as Latin).
const keywordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)

// Assemble the grounding block from the cached corpus, capped at the token budget (ADR-0004). The
// corpus is small by design, so when everything fits it is all injected in a stable order. When it
// outgrows the budget, the keyword/title fallback (no embeddings, ADR-0004) ranks docs by how many
// of the question's words their title and text contain and packs the most relevant that fit. An
// empty corpus yields an empty block, which the guardrail turns into an honest "no procedure".
export function assembleGrounding(
  docs: GroundingDoc[],
  question: string,
  budget: number = GROUNDING_TOKEN_BUDGET,
): string {
  // Only ingested docs carry text; a skipped or blank row grounds nothing and is dropped.
  const readable = docs
    .map((doc) => ({ title: doc.title, content: (doc.content ?? '').trim() }))
    .filter((doc) => doc.content.length > 0)
  if (readable.length === 0) {
    return ''
  }

  const sized = readable.map((doc) => ({
    doc,
    tokens: estimateTokens(`${doc.title}\n${doc.content}`),
  }))
  const total = sized.reduce((sum, item) => sum + item.tokens, 0)

  // Everything fits: inject the whole corpus in a stable order and skip ranking entirely.
  if (total <= budget) {
    return readable.map(renderDoc).join('\n\n')
  }

  // The corpus outgrew the budget — the keyword/title fallback. Rank by question-word overlap, ties
  // keeping the original order so selection is deterministic, then greedily pack the docs that fit.
  const questionWords = new Set(keywordsOf(question))
  const scored = sized.map((item, index) => {
    const docWords = new Set(keywordsOf(`${item.doc.title} ${item.doc.content}`))
    let overlap = 0
    for (const word of questionWords) {
      if (docWords.has(word)) {
        overlap += 1
      }
    }
    return { ...item, index, overlap }
  })
  scored.sort((a, b) => b.overlap - a.overlap || a.index - b.index)

  const selected: { title: string; content: string }[] = []
  let remaining = budget
  for (const item of scored) {
    if (item.tokens <= remaining) {
      selected.push(item.doc)
      remaining -= item.tokens
    }
  }
  // Guard the pathological case where even the single most-relevant doc exceeds the whole budget:
  // include it anyway so grounding is never empty when readable docs exist (its text is
  // length-capped at ingestion, so the input stays bounded).
  if (selected.length === 0) {
    const top = scored[0]
    if (top) {
      selected.push(top.doc)
    }
  }
  return selected.map(renderDoc).join('\n\n')
}

// The bilingual anti-fabrication guardrail (ADR-0003, ADR-0004, ADR-0007, #57, #92, #227): one
// system prompt that pins every claim ABOUT THE CHAIN to the injected procedures AND the asking
// user's scoped task list, to the question's own language, and to an honest "there is no procedure
// for that" / "no tasks" when neither block covers a chain question, then has it name the procedures
// its answer used in a machine-read trailer (#227, parsed and stripped by the answer path) — no
// second verification pass. The one exception to the blocks is small talk (owner decision,
// 2026-08, refined twice): a bare greeting used to earn "I do not have that information", and the
// first correction (#266) over-opened the assistant into a general chatbot answering trivia and
// recipes. The settled shape is grounded-or-greeting: a greeting or casual small talk gets one warm
// sentence and an offer to help, and every actual question answers only from the blocks — an
// off-topic one is declined by naming what the assistant does cover, never answered from outside
// knowledge. Both blocks are embedded; an empty procedures block tells the model there are no
// procedures and an empty task block that there are no visible tasks, so an un-covered question
// yields the decline rather than a guess. The task block is pre-scoped by the caller (ADR-0007): the prompt says it holds
// only tasks the person may see and forbids reasoning about any task not in it, so the model can never
// talk its way to a task outside scope — the real boundary is the scoped retrieval, and this line only
// keeps the model from talking around it. It deliberately does not claim the block is *exhaustive*: a
// large board is truncated (renderTaskContext appends a notice when it is), so asserting "these are
// all your tasks" would be a lie the model could parrot.
export function buildGuardrailSystemPrompt(grounding: string, taskContext: string): string {
  const procedures = grounding.length > 0 ? grounding : '(no procedures are available)'
  const tasks = taskContext.length > 0 ? taskContext : '(no tasks are visible to you)'
  return [
    "You are Burgers Bar's staff operations assistant.",
    'Answer the question using ONLY the procedures and the task list provided below.',
    'Reply in the same language the question is written in (for example Hebrew or English).',
    'If the message is just a greeting or casual small talk (for example "good morning" or "how' +
      ' are you"), greet the person back warmly in one short sentence and offer to help with the' +
      " chain's procedures or their tasks — a greeting needs no procedure.",
    'If neither the procedures nor the task list contains the answer, say that this is outside' +
      ' what you can help with — you answer questions about Burgers Bar procedures and their' +
      ' tasks — and do not guess, invent, or use outside knowledge.',
    'The task list holds only tasks the person asking is allowed to see; never reveal, invent, or' +
      ' imply any task that is not shown in it. If the list says it is incomplete, tell them so' +
      ' rather than presenting the shown tasks as their complete set.',
    // The attribution line (#227): the answer path parses this trailer to name the knowledge docs a
    // reply drew on. It is a machine-read line, not prose the reader sees — the answer service strips
    // it before the answer is shown or persisted. Citing only procedures actually used keeps a
    // task-grounded answer or a refusal source-less; citing exact titles lets the path match each
    // against a real ingested doc and drop anything that does not.
    `After your answer, on a final separate line, write "${SOURCES_PREFIX}" followed by the exact titles of the procedures your answer used, separated by " | ". Copy each title exactly as it appears above its procedure. If your answer used no procedure — it drew only on the task list, it was a greeting, or you do not have the information — write "${SOURCES_PREFIX} none".`,
    '',
    'Procedures:',
    procedures,
    '',
    'Tasks:',
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
): LlmMessage[] {
  const recent = history.slice(-REPLAYED_TURNS)
  const replayed: LlmMessage[] = recent.map((turn) => ({
    role: turn.role === 'agent' ? 'assistant' : 'user',
    content: turn.content,
  }))
  return [
    { role: 'system', content: buildGuardrailSystemPrompt(grounding, taskContext) },
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
