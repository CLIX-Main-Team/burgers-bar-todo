import type { KnowledgeChunk } from './repository.js'

// Chunk retrieval for the answer path (ADR-0025, superseding ADR-0004's whole-doc keyword
// fallback): rank the knowledge index's chunks against the question and pack the best few into
// the grounding block. Pure — the embedding call happens in the answer service; this module
// only scores, selects, and renders, so every rule here is unit-tested directly.
//
// Two modes, decided per request:
//   - hybrid mode, when the question's embedding arrived and the index carries vectors: two
//     independent rankings fused by Reciprocal Rank Fusion. The vector arm scores every embedded
//     chunk by cosine similarity, best over the query variants (the bare question, and the
//     previous-turn-prefixed variant that keeps a follow-up like "and after that?" anchored to
//     its topic); a relevance floor keeps small talk and off-topic questions from dragging
//     arbitrary chunks in just because a budget exists. The keyword arm ranks by rare-word
//     overlap, which is what reaches the chunk that states the answer in the question's own
//     words while sitting under a topic the embedding never associates with it.
//   - keyword mode, when embeddings are unavailable (provider without embeddings, outage,
//     unfilled index): that same keyword ranking alone — over uniform chunks, which is what
//     removes the old whole-doc grounding's length bias (a 20k-char spreadsheet used to win by
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

// Reciprocal Rank Fusion: a chunk's fused score is the sum over arms of 1/(k + its rank in that
// arm). RANK is what crosses between arms, never the raw number — cosine similarity and word
// overlap are not on a comparable scale, and every scheme for making them comparable (normalise,
// weight, threshold) needs a per-corpus constant that drifts as the corpus grows. k = 50 damps
// the head: rank 1 contributes 1/51 and rank 5 contributes 1/55, so a chunk both arms like beats
// a chunk either arm likes most — which is the entire point of fusing two weak signals. The
// constant and the sum-of-reciprocals shape are lifted from the American-spa bot's hybrid_search,
// a system doing this same retrieval job over a Hebrew corpus.
export const RRF_K = 50

// Per-arm candidate caps. The vector arm mirrors the reference (twice the grounding cap, hard
// stop at 30). The keyword arm gets half the grounding slots and no more: it is the
// lower-precision signal, so fusion may broaden a vector result by up to half, never displace it
// — whatever the keyword arm surfaces, the six best cosine hits keep their seats.
export const ARM_LIMIT = Math.min(MAX_GROUNDING_CHUNKS * 2, 30)
export const KEYWORD_ARM_LIMIT = Math.floor(MAX_GROUNDING_CHUNKS / 2)

const CHARS_PER_TOKEN = 4
const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN)

// Hebrew glues its function words onto the next word as a single letter — ה the, ו and, ב in,
// ל to, מ from, כ as, ש that — so שכירות and השכירות are two different tokens for the same word.
// Left alone that wrecks the rarity measure the keyword ranking is built on: a question asking
// about השכירות makes the prefixed form look like a one-in-a-corpus rare term while the word
// itself sits in a third of the index, and chunks match on an accident of grammar. Dropping one
// leading prefix letter from long-enough tokens costs nothing when it is wrong, because the same
// rule runs over the question and the chunks alike — an over-stripped word still meets its own
// over-stripped self. Real morphology (suffixes, plurals, בכתיב מלא) is the vector arm's job.
const HEBREW_PREFIXES = new Set(['ה', 'ו', 'ב', 'ל', 'מ', 'כ', 'ש'])
const stripPrefix = (word: string): string =>
  word.length >= 4 && HEBREW_PREFIXES.has(word[0] as string) ? word.slice(1) : word

// Lowercased word tokens for the keyword overlap — bilingual (the Unicode letter class covers
// Hebrew and Latin), punctuation splits, one/two-letter tokens dropped. The split is the one
// ADR-0004's grounding used, so this still ranks by the same notion of a word.
const keywordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)
    .map(stripPrefix)

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

interface RankedChunk {
  chunk: KnowledgeChunk
  index: number
  score: number
}

// Provenance survives the fusion: the probe — and anyone tuning against it — has to see which arm
// brought a chunk in and how strongly, which a single fused number cannot say.
interface FusedChunk extends RankedChunk {
  vectorScore: number | null
  keywordRank: number | null
}

// The vector arm: score every embedded chunk against the query vectors, best-variant-wins, then
// keep what clears the floor and sits within the band of the best hit. Chunks the backfill has not
// reached (embedding null) are invisible here — they can still arrive through the keyword arm.
const rankByVectors = (chunks: KnowledgeChunk[], queryVectors: number[][]): RankedChunk[] => {
  const scored = chunks.flatMap((chunk, index) => {
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

  // Best score first; ties keep index order so selection is deterministic.
  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  // Trim the tail far below the best hit — topic-adjacent noise (a department dashboard mentions
  // everything) stays out of a strong hit's context. Deliberately no minimum for the top itself:
  // whether a borderline best chunk answers the question is the model's call under the guardrail,
  // not retrieval's (see the threshold comment above).
  const top = scored[0]
  const banded = top
    ? scored.filter((candidate) => candidate.score >= top.score - TOP_SCORE_BAND)
    : scored
  return banded.slice(0, ARM_LIMIT)
}

// The keyword arm: rank chunks by how much RARE question vocabulary they carry, zero-overlap
// chunks excluded — a greeting matches nothing and grounds nothing, exactly like the vector floor.
//
// Counting matched words cannot do this job. For "מתי מכניסים תזכורות ליומן על סיום חוזה שכירות?"
// the lease dashboards match שכירות + סיום + חוזה while the branch-opening checklist that actually
// states the rule matches תזכורות + ליומן + סיום, and a plain count calls that a tie — which is how
// the 2026-08 graded exam got its one false decline: the answer was in the corpus, in the
// question's own words, and nothing brought it forward. Weighting each matched word by its inverse
// document frequency across the index breaks the tie on evidence: in that corpus ליומן appears in
// one document of 37 and שכירות in nine, so the chunk carrying the rare word wins. The df is
// computed per request over the question's words only — the whole index is already in memory for
// the cosine pass, so this is one more scan and no new infrastructure.
const rankByKeywords = (
  chunks: KnowledgeChunk[],
  question: string,
  limit: number,
): RankedChunk[] => {
  const questionWords = new Set(keywordsOf(question))
  if (questionWords.size === 0) {
    return []
  }

  const matched = chunks.map((chunk) => {
    const chunkWords = new Set(keywordsOf(`${chunk.docTitle} ${chunk.content}`))
    return [...questionWords].filter((word) => chunkWords.has(word))
  })

  const documentFrequency = new Map<string, number>()
  for (const words of matched) {
    for (const word of words) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1)
    }
  }

  const ranked = chunks.flatMap((chunk, index) => {
    const words = matched[index] as string[]
    if (words.length === 0) {
      return []
    }
    const score = words.reduce(
      (sum, word) => sum + Math.log(1 + chunks.length / (documentFrequency.get(word) as number)),
      0,
    )
    return [{ chunk, index, score }]
  })

  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked.slice(0, limit)
}

// Fuse the arms by Reciprocal Rank Fusion, best fused score first, ties in index order so the
// selection stays deterministic. A chunk both arms ranked carries both reciprocals and rises above
// either arm's leader — the agreement bonus that makes fusion worth more than concatenation.
const fuse = (vectorArm: RankedChunk[], keywordArm: RankedChunk[]): FusedChunk[] => {
  const fused = new Map<number, FusedChunk>()
  const entryFor = (candidate: RankedChunk): FusedChunk => {
    const existing = fused.get(candidate.index)
    if (existing) {
      return existing
    }
    const created: FusedChunk = {
      chunk: candidate.chunk,
      index: candidate.index,
      score: 0,
      vectorScore: null,
      keywordRank: null,
    }
    fused.set(candidate.index, created)
    return created
  }

  vectorArm.forEach((candidate, position) => {
    const entry = entryFor(candidate)
    entry.score += 1 / (RRF_K + position + 1)
    entry.vectorScore = candidate.score
  })
  keywordArm.forEach((candidate, position) => {
    const entry = entryFor(candidate)
    entry.score += 1 / (RRF_K + position + 1)
    entry.keywordRank = position + 1
  })

  return [...fused.values()].sort((a, b) => b.score - a.score || a.index - b.index)
}

// Render the selected chunks grouped by parent doc, docs in first-selection order, each doc's
// chunks in document order under one exact `## title` heading (the citation key, #227). A gap
// between non-adjacent chunks of the same doc is marked so the model never reads two spliced
// fragments as continuous text.
const render = (selected: { chunk: KnowledgeChunk }[]): string => {
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
  mode: 'hybrid' | 'keyword'
  block: string
  selected: {
    docTitle: string
    chunkIndex: number
    tokens: number
    score: number
    vectorScore: number | null
    keywordRank: number | null
  }[]
}

export function retrieveGrounding(
  chunks: KnowledgeChunk[],
  question: string,
  queryVectors: number[][],
  budget: number = GROUNDING_TOKEN_BUDGET,
): RetrievedGrounding {
  const hasVectors = queryVectors.length > 0 && chunks.some((chunk) => chunk.embedding !== null)
  const vectorArm = hasVectors ? rankByVectors(chunks, queryVectors) : []

  // The keyword arm broadens a vector result; it never creates one. When nothing clears the
  // relevance floor the question is small talk or off-topic — measured, and the probe battery's
  // greetings depend on retrieving nothing at all — so a stray word match must not manufacture
  // grounding where the semantic signal found none. In keyword mode there is no vector arm to
  // gate on, and the keyword ranking stands alone with the full candidate cap.
  const keywordArm =
    hasVectors && vectorArm.length === 0
      ? []
      : rankByKeywords(chunks, question, hasVectors ? KEYWORD_ARM_LIMIT : ARM_LIMIT)

  const selected: FusedChunk[] = []
  let remaining = budget
  for (const candidate of fuse(vectorArm, keywordArm)) {
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
    mode: hasVectors ? 'hybrid' : 'keyword',
    block: selected.length > 0 ? render(selected) : '',
    selected: selected.map(({ chunk, score, vectorScore, keywordRank }) => ({
      docTitle: chunk.docTitle,
      chunkIndex: chunk.chunkIndex,
      tokens: estimateTokens(chunk.content),
      score,
      vectorScore,
      keywordRank,
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
