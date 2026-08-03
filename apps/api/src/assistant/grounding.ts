import type { LlmMessage } from './llm-client.js'
import type { MessageRow } from './thread-repository.js'

// The grounding-and-prompt assembly for the answer path (ADR-0003, ADR-0004, ADR-0013): the pure
// step that turns the knowledge cache and a thread's history into the messages the LLM is called
// with. Kept free of I/O so the token budget, the keyword/title fallback, and the bilingual
// anti-fabrication guardrail are unit-tested directly, and the answer service is left as thin
// orchestration over the injected port.

// The answer's max_tokens budget (~800, ADR-0013): a floor-shift answer is short, and a cap keeps
// the cost and latency of every call bounded.
export const ANSWER_MAX_TOKENS = 800

// How many prior turns are replayed to the model for context (~10, ADR-0013). Enough to hold a
// follow-up's thread (story 7) without letting a long thread's history blow the input budget.
export const REPLAYED_TURNS = 10

// The grounding token budget: the cap on how much cached procedure text is injected (ADR-0004,
// "inject relevant docs up to a token budget"). Estimated in tokens via a coarse chars-per-token
// ratio — there is no tokenizer on the request path, and the cap only needs to be approximately
// right to keep the input bounded. Per-doc content is already length-capped at ingestion (#88).
export const GROUNDING_TOKEN_BUDGET = 6_000
const CHARS_PER_TOKEN = 4

// A cached procedure as grounding reads it — just the title and its extracted text. The answer path
// passes the ingested docs; a skipped/near-empty row carries no content and grounds nothing.
export interface GroundingDoc {
  title: string
  content: string | null
}

const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

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

// The bilingual anti-fabrication guardrail (ADR-0003, ADR-0004, #57): one system prompt that pins
// the model to the injected procedures, to the question's own language, and to an honest "there is
// no procedure for that" when the grounding does not cover the question — with no source citation
// and no second verification pass. The grounding block is embedded; when it is empty the model is
// told there are no procedures, so an un-grounded question yields "I don't know" rather than a guess.
export function buildGuardrailSystemPrompt(grounding: string): string {
  const procedures = grounding.length > 0 ? grounding : '(no procedures are available)'
  return [
    "You are Burgers Bar's staff operations assistant.",
    'Answer the question using ONLY the procedures provided below.',
    'Reply in the same language the question is written in (for example Hebrew or English).',
    'If the procedures do not contain the answer, say plainly that there is no procedure for that —' +
      ' do not guess, invent, or use outside knowledge.',
    'Do not mention, quote, or cite the procedures or their sources; simply answer.',
    '',
    'Procedures:',
    procedures,
  ].join('\n')
}

// Assemble the messages for one answer (ADR-0013): the guardrail-plus-grounding system turn, then
// the last REPLAYED_TURNS prior turns of the thread in order (an `agent` turn maps to the wire role
// `assistant`), then the new question as the final user turn. The new question is not yet in
// `history` — it is persisted only after a successful answer (ADR-0003) — so it is appended here.
export function buildLlmMessages(
  grounding: string,
  history: MessageRow[],
  question: string,
): LlmMessage[] {
  const recent = history.slice(-REPLAYED_TURNS)
  const replayed: LlmMessage[] = recent.map((turn) => ({
    role: turn.role === 'agent' ? 'assistant' : 'user',
    content: turn.content,
  }))
  return [
    { role: 'system', content: buildGuardrailSystemPrompt(grounding) },
    ...replayed,
    { role: 'user', content: question },
  ]
}
