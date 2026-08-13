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

// ~3k tokens of grounding: enough for several relevant chunks while leaving the model's input
// mostly question, history, and tasks — the probe showed 6k of mostly-noise grounding is what
// starved a thinking model's budget (#263).
export const GROUNDING_TOKEN_BUDGET = 3_000

// At CHUNK_TARGET_CHARS ≈ 450 tokens, eight chunks lands at the budget; the cap exists so a
// corpus of tiny chunks cannot flood the prompt with twenty fragments.
export const MAX_GROUNDING_CHUNKS = 8

// The vector-mode relevance thresholds, set from the probe battery's measured score landscape
// on the real corpus (2026-08, qwen3-embedding-8b @1024): every genuinely-covered question's
// TOP chunk scored ≥ 0.567 (same- and cross-language), while the best chunk any greeting,
// off-topic, or unanswerable question surfaced topped out at 0.451. Tune these against the
// probe battery, never by feel.
//
// The top-score gate is what grounds NOTHING for small talk and off-topic questions — when the
// best available chunk is this weak, the honest state is "the corpus does not cover this", and
// injecting near-noise would only invite the model to stretch it.
export const MIN_TOP_SCORE = 0.5
// The per-chunk floor and the top-relative band trim the tail once the gate passes: chunks far
// below the best hit are topic-adjacent noise (a department dashboard mentions everything).
export const MIN_VECTOR_SCORE = 0.45
export const TOP_SCORE_BAND = 0.15

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

  // Vector mode's honesty gates: no grounding at all when even the best chunk is weak, and no
  // tail of topic-adjacent noise far below the best hit once it is not.
  if (hasVectors) {
    const top = scored[0]
    if (!top || top.score < MIN_TOP_SCORE) {
      return { block: '', selected: [] }
    }
    scored = scored.filter((candidate) => candidate.score >= top.score - TOP_SCORE_BAND)
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
