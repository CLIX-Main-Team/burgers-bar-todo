import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '../src/assistant/repository.js'
import {
  GROUNDING_TOKEN_BUDGET,
  KEYWORD_ARM_LIMIT,
  MAX_GROUNDING_CHUNKS,
  MIN_VECTOR_SCORE,
  buildQueryTexts,
  retrieveGrounding,
} from '../src/assistant/retrieval.js'

// The retrieval rules (ADR-0025) as pure unit cases: mode choice, each arm's ranking, their
// fusion, the relevance floor, the budget and count caps, and the doc-grouped rendering whose
// `## title` headings extractSources keys citations off (#227). Vectors here are hand-built unit
// geometry — the tests pin the selection mechanics, never a real model's similarity landscape.

const chunk = (over: Partial<KnowledgeChunk> & { docTitle: string }): KnowledgeChunk => ({
  docId: over.docTitle,
  chunkIndex: 0,
  content: `content of ${over.docTitle}`,
  embedding: null,
  gist: null,
  ...over,
})

describe('retrieveGrounding — hybrid mode, the vector arm', () => {
  it('ranks embedded chunks by cosine, keeping only the band near the best hit', () => {
    const chunks = [
      chunk({ docTitle: 'far', embedding: [0, 1] }),
      chunk({ docTitle: 'near', embedding: [1, 0] }),
      chunk({ docTitle: 'mid', embedding: [1, 1] }),
    ]
    const { selected } = retrieveGrounding(chunks, 'q', [[1, 0]])
    // 'near' is exact (cosine 1); 'mid' (≈0.707) falls below the top-relative band and 'far'
    // (cosine 0) below everything — topic-adjacent noise stays out once a strong hit exists.
    expect(selected.map((s) => s.docTitle)).toEqual(['near'])
  })

  it('takes the best score across query variants (the follow-up variant can win)', () => {
    const chunks = [chunk({ docTitle: 'topic', embedding: [1, 0] })]
    // The bare question is orthogonal, the history-prefixed variant matches: still retrieved.
    const { selected } = retrieveGrounding(chunks, 'q', [
      [0, 1],
      [1, 0],
    ])
    expect(selected.map((s) => s.docTitle)).toEqual(['topic'])
  })

  it('cuts outright junk below the floor — far-noise never grounds', () => {
    // cosine([1,0], [x, y]) = x for a unit vector: build one just under the floor.
    const x = MIN_VECTOR_SCORE - 0.02
    const y = Math.sqrt(1 - x * x)
    const chunks = [chunk({ docTitle: 'junk', embedding: [x, y] })]
    const { block, selected } = retrieveGrounding(chunks, 'hey how are you', [[1, 0]])
    expect(selected).toEqual([])
    expect(block).toBe('')
  })

  it('still retrieves a borderline best chunk — a terse covered question is the model’s call', () => {
    // Measured on the client's real prod question ("מהו נוהל הפתיחה?" topped at 0.414 while a
    // greeting's best noise hit 0.451): no absolute gate can separate them, so retrieval must
    // hand a borderline top candidate to the model rather than hard-declining.
    const x = MIN_VECTOR_SCORE + 0.05
    const y = Math.sqrt(1 - x * x)
    const chunks = [chunk({ docTitle: 'borderline', embedding: [x, y] })]
    const { selected } = retrieveGrounding(chunks, 'מהו נוהל הפתיחה?', [[1, 0]])
    expect(selected.map((s) => s.docTitle)).toEqual(['borderline'])
  })

  it('ignores un-embedded chunks (only the keyword arm can still reach them)', () => {
    const chunks = [
      chunk({ docTitle: 'embedded', embedding: [1, 0] }),
      chunk({ docTitle: 'pending', embedding: null }),
    ]
    const { mode, selected } = retrieveGrounding(chunks, 'q', [[1, 0]])
    expect(mode).toBe('hybrid')
    expect(selected.map((s) => s.docTitle)).toEqual(['embedded'])
  })

  it('caps the selection at the chunk count and the token budget', () => {
    const many = Array.from({ length: MAX_GROUNDING_CHUNKS + 4 }, (_, i) =>
      chunk({
        docTitle: `doc-${i}`,
        docId: `doc-${i}`,
        embedding: [1, 0],
        content: 'x'.repeat(400),
      }),
    )
    const counted = retrieveGrounding(many, 'q', [[1, 0]])
    expect(counted.selected.length).toBe(MAX_GROUNDING_CHUNKS)

    const huge = [
      chunk({
        docTitle: 'fits',
        embedding: [1, 0],
        content: 'x'.repeat(GROUNDING_TOKEN_BUDGET * 4 - 400),
      }),
      chunk({
        docTitle: 'overflow',
        docId: 'overflow',
        embedding: [0.99, 0.01],
        content: 'y'.repeat(2_000),
      }),
      chunk({ docTitle: 'small', docId: 'small', embedding: [0.9, 0.1], content: 'z'.repeat(200) }),
    ]
    const budgeted = retrieveGrounding(huge, 'q', [[1, 0]])
    // The best fills nearly the whole budget; the next-best no longer fits and is skipped, but a
    // smaller later chunk that still fits is packed.
    expect(budgeted.selected.map((s) => s.docTitle)).toEqual(['fits', 'small'])
  })
})

describe('retrieveGrounding — hybrid mode, the keyword arm and the fusion', () => {
  it('reaches the chunk the vector arm never saw — the graded exam’s false decline', () => {
    // 2026-08-13, verbatim: the rule this asks for is written in the branch-opening checklist
    // ("הכנסת תזכורות ליומן לתאריכי סיום הסכם- 3 חודשים לפני סיום…") while every word of the
    // question's vocabulary points at the lease dashboards. Cosine alone filled the grounding
    // with rentals data and the model honestly reported not finding the rule.
    const chunks = [
      chunk({
        docTitle: 'דשבורד הסכמי שכירות',
        docId: 'lease-1',
        content: 'סיום חוזה שכירות בסניף',
        embedding: [1, 0],
      }),
      chunk({
        docTitle: 'מיפוי הסכמי זיכיון',
        docId: 'lease-2',
        content: 'טבלת חוזה שכירות עם תאריך סיום',
        embedding: [1, 0],
      }),
      chunk({
        docTitle: 'צק ליסט פתיחת סניף',
        docId: 'checklist',
        content: 'הכנסת תזכורות ליומן לתאריכי סיום הסכם 3 חודשים לפני',
        // Orthogonal to the query: the embedding never associates the admin checklist with a
        // question phrased in lease vocabulary, so the vector arm cannot see this chunk at all.
        embedding: [0, 1],
      }),
    ]
    const { selected } = retrieveGrounding(
      chunks,
      'מתי מכניסים תזכורות ליומן על סיום חוזה שכירות?',
      [[1, 0]],
    )
    const checklist = selected.find((s) => s.docTitle === 'צק ליסט פתיחת סניף')
    expect(checklist).toBeDefined()
    // Brought in by the keyword arm alone, and ranked first there: ליומן and תזכורות are rare in
    // this corpus while סיום/חוזה/שכירות are everywhere.
    expect(checklist?.vectorScore).toBeNull()
    expect(checklist?.keywordRank).toBe(1)
  })

  it('lifts a chunk both arms ranked above either arm’s leader', () => {
    const chunks = [
      chunk({
        docTitle: 'cosine-leader',
        docId: 'a',
        embedding: [1, 0],
        content: 'טקסט ללא מילות השאלה',
      }),
      chunk({
        docTitle: 'both-arms',
        docId: 'b',
        embedding: [0.99, 0.01],
        content: 'הכנסת תזכורות ליומן',
      }),
    ]
    const { selected } = retrieveGrounding(chunks, 'תזכורות ליומן', [[1, 0]])
    // 'a' leads the vector arm, 'b' leads the keyword arm and is second on cosine: the two
    // reciprocals it carries beat the single one 'a' has.
    expect(selected.map((s) => s.docTitle)).toEqual(['both-arms', 'cosine-leader'])
  })

  it('lets the keyword arm claim at most half the grounding slots', () => {
    const vectorSide = Array.from({ length: MAX_GROUNDING_CHUNKS }, (_, i) =>
      chunk({
        docTitle: `vec-${i}`,
        docId: `vec-${i}`,
        embedding: [1, 0],
        content: 'no shared vocabulary here',
      }),
    )
    const keywordSide = Array.from({ length: MAX_GROUNDING_CHUNKS }, (_, i) =>
      chunk({
        docTitle: `kw-${i}`,
        docId: `kw-${i}`,
        embedding: [0, 1],
        content: 'הכנסת תזכורות ליומן',
      }),
    )
    const { selected } = retrieveGrounding([...vectorSide, ...keywordSide], 'תזכורות ליומן', [
      [1, 0],
    ])
    expect(selected.length).toBe(MAX_GROUNDING_CHUNKS)
    expect(selected.filter((s) => s.vectorScore === null).length).toBe(KEYWORD_ARM_LIMIT)
    expect(selected.filter((s) => s.vectorScore !== null).length).toBe(
      MAX_GROUNDING_CHUNKS - KEYWORD_ARM_LIMIT,
    )
  })

  it('matches across languages through the chunk’s other-language gist', () => {
    // The 2026-08-13 flip test in unit form: the same lease-reminder rule, asked in English. The
    // question shares no characters with the Hebrew checklist, so without the gist the keyword arm
    // cannot see it at all and only cosine runs — which is the arm that missed this question.
    const chunks = [
      chunk({
        docTitle: 'דשבורד הסכמי שכירות',
        docId: 'lease',
        content: 'סיום חוזה שכירות בסניף',
        gist: 'Lease agreements dashboard: per-branch lease end dates and option periods.',
        embedding: [1, 0],
      }),
      chunk({
        docTitle: 'צק ליסט פתיחת סניף',
        docId: 'checklist',
        content: 'הכנסת תזכורות ליומן לתאריכי סיום הסכם 3 חודשים לפני סיום',
        gist: 'Branch opening checklist: put calendar reminders three, two and one month before the lease agreement ends.',
        embedding: [0, 1],
      }),
    ]
    const { selected } = retrieveGrounding(
      chunks,
      'When do we put calendar reminders in before a lease ends?',
      [[1, 0]],
    )
    const checklist = selected.find((s) => s.docTitle === 'צק ליסט פתיחת סניף')
    expect(checklist?.vectorScore).toBeNull()
    expect(checklist?.keywordRank).toBe(1)
  })

  it('does not manufacture grounding when nothing clears the floor', () => {
    // The keyword arm broadens a vector result, it never creates one — a greeting that happens to
    // share a word with a shift table must still retrieve nothing at all.
    const chunks = [
      chunk({ docTitle: 'משמרות', content: 'משמרת בוקר מתחילה בשבע', embedding: [0, 1] }),
    ]
    const { block, selected } = retrieveGrounding(chunks, 'בוקר טוב, מה נשמע?', [[1, 0]])
    expect(selected).toEqual([])
    expect(block).toBe('')
  })
})

describe('retrieveGrounding — keyword fallback', () => {
  it('falls back to keyword overlap when no query vectors arrived', () => {
    const chunks = [
      chunk({ docTitle: 'הזמנות לחם', content: 'נוהל הזמנת לחמניות לסניף מהמאפייה' }),
      chunk({ docTitle: 'דוח תדלוקים', docId: 'fuel', content: 'רכב 123 תדלק 250 ליטר' }),
    ]
    const { mode, selected } = retrieveGrounding(chunks, 'איך מזמינים לחמניות לסניף?', [])
    expect(mode).toBe('keyword')
    expect(selected.map((s) => s.docTitle)).toEqual(['הזמנות לחם'])
  })

  it('falls back to keywords when the index has no embedded chunk at all', () => {
    const chunks = [chunk({ docTitle: 'grill', content: 'closing the grill: shut the gas valve' })]
    const { selected } = retrieveGrounding(chunks, 'how do I close the grill?', [[1, 0]])
    expect(selected.map((s) => s.docTitle)).toEqual(['grill'])
  })

  it('grounds nothing on zero overlap — a greeting matches no chunk', () => {
    const chunks = [chunk({ docTitle: 'grill', content: 'closing the grill: shut the gas valve' })]
    const { block, selected } = retrieveGrounding(chunks, 'בוקר טוב', [])
    expect(selected).toEqual([])
    expect(block).toBe('')
  })

  it('ranks uniformly-sized chunks by overlap, ties in index order', () => {
    const chunks = [
      chunk({ docTitle: 'one-hit', content: 'valve maintenance schedule' }),
      chunk({ docTitle: 'two-hits', docId: 'two', content: 'grill valve cleaning steps' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'grill valve', [])
    expect(selected.map((s) => s.docTitle)).toEqual(['two-hits', 'one-hit'])
  })

  it('weighs a rare word above a common one — one rare match beats one common match', () => {
    // Both chunks match exactly one question word, so a plain overlap count ties them and index
    // order would put the common one first. Its word is in nine of ten chunks; the other's is in
    // one, and that is the whole difference between answering and declining.
    const chunks = [
      chunk({ docTitle: 'common', docId: 'common', content: 'חוזה שכירות של הסניף' }),
      chunk({ docTitle: 'rare', docId: 'rare', content: 'הכנסת תזכורות ליומן' }),
      ...Array.from({ length: 8 }, (_, i) =>
        chunk({ docTitle: `filler-${i}`, docId: `filler-${i}`, content: `שכירות סניף ${i}` }),
      ),
    ]
    const { selected } = retrieveGrounding(chunks, 'תזכורות שכירות', [])
    expect(selected[0]?.docTitle).toBe('rare')
  })
})

describe('retrieveGrounding — rendering (#227 citation contract)', () => {
  it('groups selected chunks by doc under one exact `## title` heading, gaps marked', () => {
    const chunks = [
      chunk({
        docTitle: 'צק ליסט פתיחת סניף',
        docId: 'open',
        chunkIndex: 0,
        content: 'שלב 1',
        embedding: [1, 0],
      }),
      chunk({
        docTitle: 'צק ליסט פתיחת סניף',
        docId: 'open',
        chunkIndex: 2,
        content: 'שלב 3',
        embedding: [0.95, 0.05],
      }),
      chunk({
        docTitle: 'ביטוח',
        docId: 'ins',
        chunkIndex: 0,
        content: 'פוליסה',
        embedding: [0.9, 0.1],
      }),
    ]
    const { block } = retrieveGrounding(chunks, 'q', [[1, 0]])
    expect(block).toBe('## צק ליסט פתיחת סניף\nשלב 1\n[…]\nשלב 3\n\n## ביטוח\nפוליסה')
  })
})

describe('buildQueryTexts', () => {
  it('is the bare question without history', () => {
    expect(buildQueryTexts('מה המשימות שלי?', undefined)).toEqual(['מה המשימות שלי?'])
  })

  it('adds a previous-turn-prefixed variant when history exists', () => {
    expect(buildQueryTexts('ומה אחרי זה?', 'מה צריך לעשות בפתיחת סניף?')).toEqual([
      'ומה אחרי זה?',
      'מה צריך לעשות בפתיחת סניף?\nומה אחרי זה?',
    ])
  })
})
