import type { KnowledgeChunk } from './repository.js'

// Chunk retrieval for the answer path (ADR-0025, superseding ADR-0004's whole-doc keyword
// fallback): rank the knowledge index's chunks against the question and pack the best few into
// the grounding block. Pure — the embedding call happens in the answer service; this module
// only scores, selects, and renders, so every rule here is unit-tested directly.
//
// Two modes, decided per request:
//   - vector mode, when the question's embedding arrived and the index carries vectors: score
//     every embedded chunk by cosine similarity, best over the query variants (the bare
//     question, and the previous-turn-prefixed variant that keeps a follow-up like "and after
//     that?" anchored to its topic). A relevance floor keeps small talk and off-topic questions
//     from dragging arbitrary chunks in just because a budget exists.
//   - keyword mode, when embeddings are unavailable (provider without embeddings, outage,
//     unfilled index): the bag-of-words overlap the old grounding used — but over uniform
//     chunks, which is what removes its length bias (a 20k-char spreadsheet used to win by
//     containing every word; its chunks now compete one row-group at a time).
//
// Selection is capped by count and token budget, and rendered grouped by parent doc under the
// exact `## title` heading extractSources keys citations off.

// ~4k tokens of grounding (was 3k): the 2026-08 field audit caught the cost of cutting too
// early — for "What is the opening procedure?" the substantive daily-opening SOP chunk ranked
// 11th, and the 8-chunk / 3k ceiling excluded it, so the model declared the procedure absent
// while the corpus held it. 4k still leaves the input mostly question, history, and tasks
// (the 6k-of-noise regime that starved a thinking model's budget in #263 stays far away).
export const GROUNDING_TOKEN_BUDGET = 4_000

// Twelve chunks (was eight), measured against the same audit case: rank 11 must be reachable
// when the budget allows it. The cap still exists so a corpus of tiny chunks cannot flood the
// prompt with twenty fragments.
export const MAX_GROUNDING_CHUNKS = 12

// The vector-mode relevance thresholds, set from the probe battery's measured score landscape
// on the real corpus (2026-08, qwen3-embedding-8b @1024) — including the client's real prod
// questions, which is what killed the obvious design: a hard "ground nothing below X" gate.
// The measured landscape overlaps — a well-phrased covered question tops ≥ 0.567, but the
// client's short "מהו נוהל הפתיחה?" tops at 0.414 with the right doc at 0.409, while an
// English greeting's best NOISE chunk reaches 0.451. No absolute threshold admits the former
// and blocks the latter. So there is no gate: retrieval hands the model the best few
// candidates and the guardrail's answer-only-from-the-material honesty decides — which the
// live battery proves the model does reliably (it declines off-topic with chunks present, and
// greets warmly regardless). The floor only cuts outright junk, and the top-relative band
// keeps a strong hit's context clean; a weak-scoring question simply carries a few borderline
// chunks (≈ a fraction of a cent) so a covered-but-tersely-phrased question is never
// hard-declined by the retrieval layer. Tune against the probe battery, never by feel.
export const MIN_VECTOR_SCORE = 0.35
export const TOP_SCORE_BAND = 0.12

const CHARS_PER_TOKEN = 4
const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

// Lowercased word tokens for the keyword overlap — bilingual (the Unicode letter class covers
// Hebrew and Latin), punctuation splits, one/two-letter tokens dropped. Lifted verbatim from
// the ADR-0004 grounding it replaces, so keyword mode ranks by the same notion of a word.
const keywordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)

const cosine = (a: number[], b: number[]): number => {
  if (a.length === 0 || a.length !== b.length) {
    return -1
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number
    const y = b[i] as number
    dot += x * y
    normA += x * x
    normB += y * y
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? -1 : dot / denom
}

interface ScoredChunk {
  chunk: KnowledgeChunk
  index: number
  score: number
}

// Score every embedded chunk against the query vectors, best-variant-wins. Chunks the backfill
// has not reached (embedding null) are invisible here — they surface again in keyword mode.
const scoreByVectors = (chunks: KnowledgeChunk[], queryVectors: number[][]): ScoredChunk[] =>
  chunks.flatMap((chunk, index) => {
    if (!chunk.embedding || chunk.embedding.length === 0) {
      return []
    }
    let score = -1
    for (const query of queryVectors) {
      const similarity = cosine(query, chunk.embedding)
      if (similarity > score) {
        score = similarity
      }
    }
    return score >= MIN_VECTOR_SCORE ? [{ chunk, index, score }] : []
  })

// The keyword fallback: question-word overlap against the chunk's title+content, zero-overlap
// chunks excluded — a greeting matches nothing and grounds nothing, exactly like vector mode's
// floor.
const scoreByKeywords = (chunks: KnowledgeChunk[], question: string): ScoredChunk[] => {
  const questionWords = new Set(keywordsOf(question))
  return chunks.flatMap((chunk, index) => {
    const chunkWords = new Set(keywordsOf(`${chunk.docTitle} ${chunk.content}`))
    let overlap = 0
    for (const word of questionWords) {
      if (chunkWords.has(word)) {
        overlap += 1
      }
    }
    return overlap > 0 ? [{ chunk, index, score: overlap }] : []
  })
}

// Render the selected chunks grouped by parent doc, docs in first-selection order, each doc's
// chunks in document order under one exact `## title` heading (the citation key, #227). A gap
// between non-adjacent chunks of the same doc is marked so the model never reads two spliced
// fragments as continuous text.
const render = (selected: ScoredChunk[]): string => {
  const byDoc = new Map<string, { title: string; chunks: KnowledgeChunk[] }>()
  for (const { chunk } of selected) {
    const entry = byDoc.get(chunk.docId)
    if (entry) {
      entry.chunks.push(chunk)
    } else {
      byDoc.set(chunk.docId, { title: chunk.docTitle, chunks: [chunk] })
    }
  }
  const blocks: string[] = []
  for (const { title, chunks } of byDoc.values()) {
    const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)
    const parts: string[] = []
    let previousIndex: number | null = null
    for (const chunk of ordered) {
      if (previousIndex !== null && chunk.chunkIndex > previousIndex + 1) {
        parts.push('[…]')
      }
      parts.push(chunk.content)
      previousIndex = chunk.chunkIndex
    }
    blocks.push(`## ${title}\n${parts.join('\n')}`)
  }
  return blocks.join('\n\n')
}

// Retrieve the grounding block for one question. queryVectors carries the embeddings of the
// query variants (empty when the embedding call failed or is unavailable). Returns the rendered
// block plus the selection itself, which the probe reports and tests assert on.
export interface RetrievedGrounding {
  block: string
  selected: { docTitle: string; chunkIndex: number; tokens: number; score: number }[]
}

export function retrieveGrounding(
  chunks: KnowledgeChunk[],
  question: string,
  queryVectors: number[][],
  budget: number = GROUNDING_TOKEN_BUDGET,
): RetrievedGrounding {
  const hasVectors = queryVectors.length > 0 && chunks.some((chunk) => chunk.embedding !== null)
  let scored = hasVectors ? scoreByVectors(chunks, queryVectors) : scoreByKeywords(chunks, question)

  // Best score first; ties keep index order so selection is deterministic.
  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  // Trim the tail far below the best hit — topic-adjacent noise (a department dashboard
  // mentions everything) stays out of a strong hit's context. Deliberately no minimum for the
  // top itself: whether a borderline best chunk answers the question is the model's call under
  // the guardrail, not retrieval's (see the threshold comment above).
  if (hasVectors) {
    const top = scored[0]
    if (top) {
      scored = scored.filter((candidate) => candidate.score >= top.score - TOP_SCORE_BAND)
    }
  }

  const selected: ScoredChunk[] = []
  let remaining = budget
  for (const candidate of scored) {
    if (selected.length >= MAX_GROUNDING_CHUNKS) {
      break
    }
    const tokens = estimateTokens(candidate.chunk.content)
    if (tokens > remaining) {
      continue
    }
    selected.push(candidate)
    remaining -= tokens
  }

  return {
    block: selected.length > 0 ? render(selected) : '',
    selected: selected.map(({ chunk, score }) => ({
      docTitle: chunk.docTitle,
      chunkIndex: chunk.chunkIndex,
      tokens: estimateTokens(chunk.content),
      score,
    })),
  }
}

// Build the query variants whose embeddings vector mode ranks with: the question itself, plus —
// when the thread has history — the previous user turn prefixed, which is what keeps a
// content-free follow-up ("ומה אחרי זה?") pointed at its topic while a topic switch still wins
// through the bare-question variant.
export function buildQueryTexts(question: string, previousUserTurn: string | undefined): string[] {
  const texts = [question]
  if (previousUserTurn && previousUserTurn.trim().length > 0) {
    texts.push(`${previousUserTurn.trim()}\n${question}`)
  }
  return texts
}
