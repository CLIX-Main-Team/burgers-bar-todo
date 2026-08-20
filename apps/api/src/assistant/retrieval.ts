import type { KnowledgeChunk, VectorHit } from './repository.js'
import { estimateTokens } from './token-budget.js'

// Chunk retrieval for the answer path (ADR-0025, superseding ADR-0004's whole-doc keyword
// fallback): rank the knowledge index's chunks against the question and pack the best few into
// the grounding block. Pure — the embedding call AND the cosine scan happen outside (the answer
// service embeds, the database scores; searchChunksByVector); this module only applies policy —
// floors, bands, fusion, selection, rendering — so every rule here is unit-tested directly.
//
// Two modes, decided per request:
//   - hybrid mode, when the question's embedding arrived and the index carries vectors: two
//     independent rankings fused by Reciprocal Rank Fusion. The vector arm is the database's
//     cosine ranking per query variant (the bare question, and the previous-turn-prefixed
//     variant that keeps a follow-up like "and after that?" anchored to its topic), handed in
//     as scored candidates; a relevance floor keeps small talk and off-topic questions from
//     dragging arbitrary chunks in just because a budget exists. The keyword arm ranks by
//     rare-word overlap, which is what reaches the chunk that states the answer in the
//     question's own words while sitting under a topic the embedding never associates with it.
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

// Both surface forms of every word, because stripping alone is not canonical and the comment above
// assumed it was. The rule fires on the leading letter, and a root's own first letter is drawn from
// the same seven: השכירות strips to שכירות, but bare שכירות strips again to כירות, so the prefixed
// and bare forms of the SAME word never meet — and מטבח collides with the unrelated טבח. Every noun
// beginning ה/ו/ב/ל/מ/כ/ש is affected, which is a large share of everyday vocabulary, and the
// keyword arm exists precisely to rescue the words cosine missed. Carrying the raw token AND its
// stripped form makes the match reflexive in every direction: השכירות carries {השכירות, שכירות} and
// שכירות carries {שכירות, כירות}, so the two meet on שכירות.
const surfaceFormsOf = (word: string): string[] => {
  const stripped = stripPrefix(word)
  return stripped === word ? [word] : [word, stripped]
}

// Hebrew vowel points and cantillation marks (U+0591–U+05C7) are Unicode category Mn, which
// `\p{L}` does not match, so the split below treats them as separators and a vowelized word
// shatters into fragments that all fail the length filter: keywordsOf('מְנַהֵל') returned []. The
// same happens to bidi control marks (U+200E/U+200F), which Google Docs and Office exports sprinkle
// through mixed-script text. Strip both before tokenizing, after NFC so a decomposed form is
// composed first.
const NIQQUD_AND_BIDI = /[\u0591-\u05C7\u200E\u200F]/gu

// The bare words of a text — bilingual (the Unicode letter class covers Hebrew and Latin),
// punctuation splits, one/two-letter tokens dropped, niqqud and bidi marks removed first. The split
// is the one ADR-0004's grounding used, so this still ranks by the same notion of a word.
const wordsOf = (text: string): string[] =>
  text
    .normalize('NFC')
    .replace(NIQQUD_AND_BIDI, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)

// Every surface form present in a text, flattened — what a CHUNK is matched against, where only
// membership matters.
export const keywordsOf = (text: string): string[] => wordsOf(text).flatMap(surfaceFormsOf)

// The QUESTION's side is kept one entry per distinct word, each carrying its forms, because scoring
// counts matched words and a word must count once. Flattening both sides instead would score
// השכירות twice (once as itself, once as שכירות) and hand every word that happens to begin with one
// of the seven prefix letters double weight — the same accident-of-grammar bias stripPrefix exists
// to remove.
interface QuestionTerm {
  word: string
  forms: string[]
}
const questionTermsOf = (text: string): QuestionTerm[] => {
  const terms = new Map<string, QuestionTerm>()
  for (const word of wordsOf(text)) {
    if (!terms.has(word)) {
      terms.set(word, { word, forms: surfaceFormsOf(word) })
    }
  }
  return [...terms.values()]
}

// What the keyword arm matches words against: the chunk's own text plus the index-time restatement
// of it in the other language (chunk-index.ts's bridge). Without the gist this arm is monolingual
// by construction — an English question shares no characters with a Hebrew document, so the words
// half of the ranking silently switches off exactly when the language changes. Measured on the
// 2026-08-13 flip test: the lease-reminder rule, reachable in Hebrew, was unreachable in English.
const keywordSurfaceOf = (chunk: KnowledgeChunk): string =>
  `${chunk.docTitle} ${chunk.content} ${chunk.gist ?? ''}`

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

// One query variant's ranking: the database's cosine candidates for that variant (already best
// first, already only embedded chunks — a chunk the backfill has not reached is invisible here and
// can still arrive through the keyword arm), mapped onto the corpus rows and cut by policy: keep
// what clears the floor and sits within the band of THAT variant's best hit. A hit whose chunk id
// is not in the corpus read is dropped — the two reads are the same visibility predicate, so that
// only happens when a sync deletes a chunk between them, and a vanished chunk must not ground.
const rankByOneVector = (
  chunksById: Map<string, RankedChunk>,
  hits: VectorHit[],
): RankedChunk[] => {
  const scored = hits.flatMap((hit) => {
    const entry = chunksById.get(hit.id)
    return entry && hit.score >= MIN_VECTOR_SCORE ? [{ ...entry, score: hit.score }] : []
  })

  // Best score first; ties keep index order so selection is deterministic regardless of the
  // database's tie order.
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

// The vector arm: rank each query variant separately, then fuse those rankings by RANK.
//
// The variants are different questions — the bare question, and the previous turn prefixed
// (buildQueryTexts) — so their cosine scores are on different scales, and pooling them into one
// sort is the same apples-to-oranges mistake the arm-level fusion exists to avoid. Measured on the
// 2026-08-16 prod corpus, on the client's own failing session: after a cited answer about the
// opening procedure they typed one word, "תסביר". That bare variant scores 0.45–0.49 against
// generic dashboards and trackers (a content-free query is mildly similar to everything), while the
// anchored variant "מהו נוהל הפתיחה?\nתסביר" scores the checklist that answers it 0.41. Best-score-
// wins therefore handed all twelve grounding seats to the noise variant, the checklist did not
// reach the model at all, and the bot honestly reported it could not find the procedure it had
// quoted twelve seconds earlier. Ranking per variant and fusing by rank keeps each variant's own
// leader: whatever the anchor variant is most sure of arrives at fused rank 1, alongside whatever
// the bare question is most sure of, so a follow-up keeps its topic while a topic SWITCH still wins
// through the bare-question variant.
//
// The fusion takes each chunk's BEST rank across the variants, not the sum the arms use. The two
// are different relationships: cosine and word-overlap are independent signals, so a chunk both
// arms like is genuinely better evidenced and deserves the sum. Query variants are not independent
// — they are the same question phrased twice — so summing rewards a chunk for being generic enough
// to match a content-free word AND the real question, which is exactly backwards. Measured on the
// same corpus: under summing, the trackers that both variants rank highly took the head, and after
// "עוד" the checklist was pushed past the 4000-token budget at position 11 and still never reached
// the model. Best-rank says only what a rank can say — this chunk is the best answer to at least
// one phrasing of the question.
//
// A single variant is returned untouched — a first question has no history, so its ranking is
// exactly what it was before this fusion existed.
const rankByVectors = (
  chunksById: Map<string, RankedChunk>,
  vectorRankings: VectorHit[][],
): RankedChunk[] => {
  const rankings = vectorRankings.map((hits) => rankByOneVector(chunksById, hits))
  const single = rankings[0]
  if (rankings.length <= 1) {
    return single ?? []
  }

  const fused = new Map<number, RankedChunk & { rrf: number }>()
  for (const ranking of rankings) {
    ranking.forEach((candidate, position) => {
      const contribution = 1 / (RRF_K + position + 1)
      const existing = fused.get(candidate.index)
      if (existing) {
        existing.rrf = Math.max(existing.rrf, contribution)
        // Provenance stays the strongest similarity any variant saw, so the probe still reports a
        // number a person can compare against the thresholds above.
        existing.score = Math.max(existing.score, candidate.score)
      } else {
        fused.set(candidate.index, { ...candidate, rrf: contribution })
      }
    })
  }

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf || b.score - a.score || a.index - b.index)
    .slice(0, ARM_LIMIT)
    .map(({ rrf: _rrf, ...candidate }) => candidate)
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
// The keyword arm holds few seats and exists to BROADEN what cosine already found, so one document
// must not spend them all. A table split into fourteen near-identical row-groups scores fourteen
// near-identical times, and a plain score sort hands it every seat — measured on the 2026-08-13
// prod corpus, the branch-opening checklist that states the reminder rule sat at keyword rank 17
// behind fourteen clones of the lease dashboard, while the same question phrased with one extra
// matching word put it at rank 4. Interleaving takes each document's best chunk, then every
// document's second-best, and so on: a document with one strong chunk is no longer outvoted by a
// document with many mediocre ones, and the phrasing stops deciding whether the rule is reachable.
// No candidate is lost — the siblings still queue up behind the first round — so this narrows what
// wins the seats, never how many there are.
const interleaveByDoc = (ranked: RankedChunk[]): RankedChunk[] => {
  const byDoc = new Map<string, RankedChunk[]>()
  for (const candidate of ranked) {
    const siblings = byDoc.get(candidate.chunk.docId)
    if (siblings) {
      siblings.push(candidate)
    } else {
      byDoc.set(candidate.chunk.docId, [candidate])
    }
  }
  const interleaved: RankedChunk[] = []
  for (let depth = 0; ; depth += 1) {
    const round = [...byDoc.values()].flatMap((siblings) => siblings[depth] ?? [])
    if (round.length === 0) {
      return interleaved
    }
    round.sort((a, b) => b.score - a.score || a.index - b.index)
    interleaved.push(...round)
  }
}

const rankByKeywords = (
  chunks: KnowledgeChunk[],
  question: string,
  limit: number,
): RankedChunk[] => {
  const questionTerms = questionTermsOf(question)
  if (questionTerms.length === 0) {
    return []
  }

  // A term matches a chunk when ANY of its surface forms appears there, and contributes once.
  const matched = chunks.map((chunk) => {
    const chunkWords = new Set(keywordsOf(keywordSurfaceOf(chunk)))
    return questionTerms.filter((term) => term.forms.some((form) => chunkWords.has(form)))
  })

  // Rarity is measured per DOCUMENT, not per chunk, because "document frequency" is what an
  // inverse-document-frequency weight means and because chunk counts make rarity depend on how a
  // source happens to be split. A word in the title of a fourteen-chunk table is carried by all
  // fourteen chunks (keywordSurfaceOf prepends docTitle), so counting chunks called it fourteen
  // times as common as the same word in a one-chunk note and discounted it away — the same family
  // as the rank-17 lease incident interleaveByDoc addresses from the other end. Counting documents
  // makes the weight a property of the corpus instead of a property of the chunker.
  const documentsWithTerm = new Map<string, Set<string>>()
  chunks.forEach((chunk, index) => {
    for (const term of matched[index] as QuestionTerm[]) {
      const docs = documentsWithTerm.get(term.word)
      if (docs) {
        docs.add(chunk.docId)
      } else {
        documentsWithTerm.set(term.word, new Set([chunk.docId]))
      }
    }
  })
  const documentCount = new Set(chunks.map((chunk) => chunk.docId)).size

  const ranked = chunks.flatMap((chunk, index) => {
    const terms = matched[index] as QuestionTerm[]
    if (terms.length === 0) {
      return []
    }
    const score = terms.reduce(
      (sum, term) =>
        sum + Math.log(1 + documentCount / (documentsWithTerm.get(term.word) as Set<string>).size),
      0,
    )
    return [{ chunk, index, score }]
  })

  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return interleaveByDoc(ranked).slice(0, limit)
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

// Retrieve the grounding block for one question. vectorRankings carries the database's cosine
// candidates per query variant (empty when the embedding call failed or is unavailable). Returns
// the rendered block plus the selection itself, which the probe reports and tests assert on.
export interface RetrievedGrounding {
  mode: 'hybrid' | 'keyword'
  block: string
  // Retrieval health, for the caller to log. An empty vector arm in hybrid mode is normal for a
  // greeting and pathological for a covered question, and the two are indistinguishable from
  // inside this pure function — but a run of them is the fingerprint of a poisoned or stale index,
  // and until now that state produced confident declines and no signal at all.
  vectorArmEmpty: boolean
  unembeddedChunks: number
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
  vectorRankings: VectorHit[][],
  budget: number = GROUNDING_TOKEN_BUDGET,
): RetrievedGrounding {
  const chunksById = new Map<string, RankedChunk>(
    chunks.map((chunk, index) => [chunk.id, { chunk, index, score: 0 }]),
  )
  const hasVectors = vectorRankings.length > 0 && chunks.some((chunk) => chunk.embedded)
  const vectorArm = hasVectors ? rankByVectors(chunksById, vectorRankings) : []

  // The keyword arm broadens a vector result; it never creates one. When nothing clears the
  // relevance floor the question is small talk or off-topic — measured, and the probe battery's
  // greetings depend on retrieving nothing at all — so a stray word match must not manufacture
  // grounding where the semantic signal found none. In keyword mode there is no vector arm to
  // gate on, and the keyword ranking stands alone with the full candidate cap.
  //
  // That gate holds only while the index is COMPLETE. When some chunks carry no vector, an empty
  // vector arm no longer means "no semantic signal", it can equally mean "the semantic signal for
  // the chunk that answers this has not been bought yet" — and this module's own contract above
  // says an unembedded chunk "can still arrive through the keyword arm", which the gate silently
  // contradicted at exactly the moment it mattered. Every partial-index window hits this: newly
  // synced documents awaiting their gists, a failed embed pass with twenty minutes to the retry, a
  // full re-embed (migration 0011 took ~8 minutes in prod). During those windows the gate turned a
  // degraded-but-serviceable retrieval into a confident "not in my documents" with nothing logged.
  // So the gate applies only when every chunk is embedded, which keeps the measured greeting
  // behaviour intact on a healthy index and needs no new threshold to tune.
  const indexComplete = chunks.every((chunk) => chunk.embedded)
  const keywordArm =
    hasVectors && vectorArm.length === 0 && indexComplete
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
    vectorArmEmpty: hasVectors && vectorArm.length === 0,
    unembeddedChunks: chunks.filter((chunk) => !chunk.embedded).length,
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

// Words that ask for more of the same rather than for something new. A turn built only from these
// carries no topic of its own, so there is nothing for either arm to match on. The list is short
// and explicit rather than clever: these are the forms actually observed in the client's threads
// and in the follow-up battery, and a word absent from it is simply treated as content, which is
// the safe direction to be wrong in — a missed continuation retrieves as it does today, while a
// content word wrongly listed here would silently freeze the thread on its old topic.
// One- and two-letter words never reach this set: wordsOf drops them, so 'מה', 'לי', 'על' and
// 'לא' are already gone by the time a turn is classified.
const CONTINUATION_WORDS = new Set([
  'עוד',
  'ועוד',
  'תסביר',
  'הסבר',
  'תפרט',
  'פרט',
  'המשך',
  'תמשיך',
  'תסכם',
  'סכם',
  'הבנתי',
  'דוגמה',
  'ומה',
  'לגבי',
  'אוקיי',
  'אוקי',
  'נו',
  'more',
  'explain',
  'continue',
  'elaborate',
  'detail',
  'details',
  'summarize',
  'summarise',
  'okay',
  'sure',
  'yes',
  'please',
  'and',
  'about',
  'what',
])

// Does this turn say anything of its own? Punctuation and short words are already stripped by
// wordsOf, so an empty result means the turn was nothing but filler.
const isContinuation = (text: string): boolean => {
  const words = wordsOf(text)
  return words.length > 0 && words.every((word) => CONTINUATION_WORDS.has(word))
}

// What retrieval should actually search for, and the variants to embed.
//
// A bare "עוד" or "תסביר" means "more of what you just told me". Searching for it literally is
// searching for nothing, and nothing is not neutral: with no signal to match, ranking falls back
// to bulk, so the biggest documents in the corpus win by having the most chunks to offer. Measured
// on the live index, six unrelated contentless turns all returned the same set, and it was exactly
// the six largest files — the dashboards and spreadsheets, several of them duplicate views of one
// another. That is how a thread about the branch-opening checklist ended up answering out of the
// lease dashboard two turns later.
//
// Prefixing the previous turn does not rescue it, which was the surprise: `${anchor}\n${question}`
// still drifted, because appending the empty turn moves the embedding off the anchor's meaning.
// Only searching for the anchor ALONE restores it, so that is what this does — walking back to the
// last turn that said something, since two contentless turns in a row ("תסביר" then "עוד") leave
// the immediately previous turn just as empty as the current one.
export function resolveQuery(
  question: string,
  priorUserTurns: string[],
): { question: string; texts: string[] } {
  if (isContinuation(question)) {
    const anchor = [...priorUserTurns].reverse().find((turn) => !isContinuation(turn))
    // No anchor means the thread opened with a continuation word, which has no topic to return to.
    if (anchor) return { question: anchor, texts: [anchor] }
  }
  const previousUserTurn = priorUserTurns.at(-1)
  const texts = [question]
  // A follow-up that DOES carry content still gets the previous turn prefixed as a second variant,
  // which is what lets "ומה לגבי הביטוח?" stay in its thread while a real topic switch still wins
  // through the bare-question variant.
  if (previousUserTurn && previousUserTurn.trim().length > 0) {
    texts.push(`${previousUserTurn.trim()}\n${question}`)
  }
  return { question, texts }
}

// Kept for the callers that have no thread behind them (the probe's single-shot battery, the
// evaluation's single-turn sets). Equivalent to resolveQuery with at most one prior turn.
export function buildQueryTexts(question: string, previousUserTurn: string | undefined): string[] {
  return resolveQuery(question, previousUserTurn ? [previousUserTurn] : []).texts
}
