import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '../src/assistant/repository.js'
import {
  GROUNDING_TOKEN_BUDGET,
  KEYWORD_ARM_LIMIT,
  MAX_GROUNDING_CHUNKS,
  MIN_VECTOR_SCORE,
  buildQueryTexts,
  resolveQuery,
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

  it('keeps a terse follow-up’s anchor — the bare variant cannot spend every seat', () => {
    // The client's real 2026-08-15 session in miniature: after a cited answer they typed one word.
    // Axis 0 is the bare follow-up ("תסביר"), axis 1 the previous-turn-anchored variant. A
    // content-free query is mildly similar to everything, so the noise scores HIGHER in absolute
    // terms (0.49) than the chunk that actually answers the thread's question (0.41) — pooling both
    // variants into one sort therefore filled every seat with noise and the answer never reached
    // the model. Ranked per variant and fused by rank, the anchor's leader keeps its place.
    const noise = (n: number) => chunk({ docTitle: `tracker-${n}`, embedding: [0.49, 0.1, 0.866] })
    const chunks = [
      ...Array.from({ length: MAX_GROUNDING_CHUNKS }, (_, n) => noise(n)),
      chunk({ docTitle: 'checklist', embedding: [0.1, 0.41, 0.906] }),
    ]
    const { selected } = retrieveGrounding(chunks, 'תסביר', [
      [1, 0, 0],
      [0, 1, 0],
    ])
    expect(selected).toHaveLength(MAX_GROUNDING_CHUNKS)
    expect(selected.map((s) => s.docTitle)).toContain('checklist')
    // Second seat: tied with the noise leader on fused rank, behind it only on raw similarity.
    expect(selected[1]?.docTitle).toBe('checklist')
  })

  it('lets a topic switch win through the bare-question variant', () => {
    // The mirror case the anchor must not break: a brand-new question mid-thread. Axis 0 is the new
    // question, axis 1 the variant still carrying the old topic. Both leaders are seated, and the
    // new topic is not outranked by the thread's history.
    const chunks = [
      chunk({ docTitle: 'old-topic', embedding: [0.1, 0.9, 0.424] }),
      chunk({ docTitle: 'new-topic', embedding: [0.97, 0.1, 0.222] }),
    ]
    const { selected } = retrieveGrounding(chunks, 'מה נוהל הפתיחה?', [
      [1, 0, 0],
      [0, 1, 0],
    ])
    expect(selected.map((s) => s.docTitle)).toEqual(['new-topic', 'old-topic'])
  })

  it('ranks a single variant exactly as it did before the fusion existed', () => {
    // A first question has no history, so there is one variant and nothing to fuse: plain cosine
    // order. This is the invariant that keeps every previously measured single-turn result intact.
    const chunks = [
      chunk({ docTitle: 'third', embedding: [0.9, 0.436] }),
      chunk({ docTitle: 'first', embedding: [1, 0] }),
      chunk({ docTitle: 'second', embedding: [0.95, 0.312] }),
    ]
    const { selected } = retrieveGrounding(chunks, 'q', [[1, 0]])
    expect(selected.map((s) => s.docTitle)).toEqual(['first', 'second', 'third'])
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

  it('does not let one document’s near-identical chunks spend every keyword seat', () => {
    // The 2026-08-13 prod corpus in unit form. The lease dashboard is one table split into
    // row-groups that each carry most of the question's vocabulary, so a plain score sort hands
    // every keyword seat to clones of a single document — measured, the checklist that states the
    // rule sat at keyword rank 17 behind fourteen of them, and only a phrasing carrying one extra
    // matching word pulled it back to rank 4. Whether the rule is reachable must not turn on that.
    const anchor = chunk({
      docTitle: 'anchor',
      docId: 'anchor',
      embedding: [1, 0],
      content: 'no shared vocabulary here',
    })
    const dashboard = Array.from({ length: KEYWORD_ARM_LIMIT + 2 }, (_, i) =>
      chunk({
        docTitle: 'lease dashboard',
        docId: 'dashboard',
        chunkIndex: i,
        content: 'lease agreement reminders ending, per branch',
      }),
    )
    const checklist = chunk({
      docTitle: 'branch opening checklist',
      docId: 'checklist',
      content: 'calendar alerts before contract end dates',
    })

    const { selected } = retrieveGrounding(
      [anchor, ...dashboard, checklist],
      'When do we put calendar reminders in for a lease agreement ending?',
      [[1, 0]],
    )

    // The checklist matches one word to the dashboard's four and still places second in the arm:
    // the first round takes each document's best chunk before any document takes a second seat.
    const found = selected.find((s) => s.docTitle === 'branch opening checklist')
    expect(found?.vectorScore).toBeNull()
    expect(found?.keywordRank).toBe(2)
  })

  it('interleaves without dropping a candidate — the siblings queue up behind', () => {
    const dashboard = Array.from({ length: 3 }, (_, i) =>
      chunk({ docTitle: 'dashboard', docId: 'dashboard', chunkIndex: i, content: 'תזכורות ליומן' }),
    )
    const other = chunk({ docTitle: 'other', docId: 'other', content: 'תזכורות ליומן' })
    const { selected } = retrieveGrounding([...dashboard, other], 'תזכורות ליומן', [])
    expect(selected.length).toBe(4)
    expect(selected.map((s) => `${s.docTitle}#${s.chunkIndex}`)).toEqual([
      'dashboard#0',
      'other#0',
      'dashboard#1',
      'dashboard#2',
    ])
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

describe('retrieveGrounding — Hebrew word matching', () => {
  it('matches a prefixed question word to the bare form in the document', () => {
    // The bug this pins: one leading prefix letter was dropped from every long token on both sides,
    // and a root's own first letter comes from the same seven — השכירות stripped to שכירות while
    // bare שכירות stripped again to כירות, so the two forms of one word never met. שכירות is the
    // ONLY word these two share, so nothing else can carry the match.
    const chunks = [
      chunk({ docTitle: 'תנאי הסכם', docId: 'lease', content: 'תקופת שכירות ותנאי הארכה' }),
      chunk({ docTitle: 'תפריט', docId: 'menu', content: 'מרכיבי המבורגר קלאסי' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'מה כולל חוזה השכירות?', [])
    expect(selected.map((s) => s.docTitle)).toEqual(['תנאי הסכם'])
  })

  it('matches in the other direction too — a bare question word to the prefixed document form', () => {
    // The document writes במשמרת, the question asks about משמרת. Stripping alone sent them to
    // משמרת and שמרת respectively: no match. משמרת is the only word the two share.
    const chunks = [
      chunk({ docTitle: 'סידור עבודה', docId: 'shifts', content: 'במשמרת הערב נדרשים שני אנשים' }),
      chunk({ docTitle: 'תפריט', docId: 'menu', content: 'מרכיבי המבורגר קלאסי' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'כמה עובדים משמרת אחת?', [])
    expect(selected.map((s) => s.docTitle)).toEqual(['סידור עבודה'])
  })

  it('does not double-weight a word just because it starts with a prefix letter', () => {
    // Both chunks match exactly one question word, each rare (one document apiece), so the score is
    // a tie and index order decides. Carrying two surface forms per word without collapsing them
    // would have scored משמרת twice and put 'prefixed' first on an accident of spelling.
    const chunks = [
      chunk({ docTitle: 'plain', docId: 'plain', content: 'ניקיון הרצפה בסוף היום' }),
      chunk({ docTitle: 'prefixed', docId: 'prefixed', content: 'משמרת בוקר מתחילה בשבע' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'ניקיון משמרת', [])
    expect(selected.map((s) => s.docTitle)).toEqual(['plain', 'prefixed'])
  })

  it('reads a vowelized question — niqqud no longer destroys the word', () => {
    // keywordsOf('מְנַהֵל') returned [] before this: niqqud marks are Unicode category Mn, \p{L}
    // does not match them, so the split treated them as separators and every fragment failed the
    // length filter. מנהל is the only word shared with the chunk.
    const chunks = [
      chunk({ docTitle: 'תפקידים', docId: 'roles', content: 'המנהל אחראי על סגירת הקופה' }),
      chunk({ docTitle: 'תפריט', docId: 'menu', content: 'מרכיבי המבורגר קלאסי' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'מי הַמְנַהֵל?', [])
    expect(selected.map((s) => s.docTitle)).toEqual(['תפקידים'])
  })

  it('reads a question carrying bidi control marks', () => {
    const chunks = [
      chunk({ docTitle: 'תפקידים', docId: 'roles', content: 'המנהל אחראי על סגירת הקופה' }),
      chunk({ docTitle: 'תפריט', docId: 'menu', content: 'מרכיבי המבורגר קלאסי' }),
    ]
    // U+200F (RLM) landing INSIDE the word, which is what Docs and Office exports emit in
    // mixed-script text. As a bare separator it split מנהל into fragments that failed the length
    // filter; stripping it first makes the word whole again.
    const { selected } = retrieveGrounding(chunks, `מי המנ${'\u200F'}הל?`, [])
    expect(selected.map((s) => s.docTitle)).toEqual(['תפקידים'])
  })

  it('measures rarity per document, so a many-chunk source cannot dilute its own words', () => {
    // ניקיון sits in two single-chunk documents (2 chunks, 2 docs); תזכורות sits in one document
    // split four ways (4 chunks, 1 doc). Counting CHUNKS called ניקיון the rarer word and ranked it
    // first; counting DOCUMENTS — which is what inverse-document-frequency means — makes תזכורות
    // rarer and puts the chunk that carries it on top. Same family as the rank-17 lease incident.
    const chunks = [
      chunk({ docTitle: 'ניקיון א', docId: 'clean-a', content: 'ניקיון הרצפה בסוף היום' }),
      chunk({ docTitle: 'ניקיון ב', docId: 'clean-b', content: 'ניקיון הגריל אחרי סגירה' }),
      ...Array.from({ length: 4 }, (_, i) =>
        chunk({
          docTitle: 'נוהל תזכורות',
          docId: 'reminders',
          chunkIndex: i,
          content: `הכנסת תזכורות ליומן שלב ${i}`,
        }),
      ),
    ]
    const { selected } = retrieveGrounding(chunks, 'ניקיון תזכורות', [])
    expect(selected[0]?.docTitle).toBe('נוהל תזכורות')
  })
})

describe('retrieveGrounding — the keyword arm during a partial index', () => {
  it('runs the keyword arm when the vector arm is empty and chunks are still unembedded', () => {
    // The blackout this pins: while the index is filling (new docs awaiting gists, a failed embed
    // pass, a full re-embed) an empty vector arm does not mean "no semantic signal", it means the
    // signal has not been bought yet. Gating the keyword arm off there turned a serviceable
    // retrieval into a confident "not in my documents" with nothing logged.
    const chunks = [
      chunk({ docTitle: 'תפריט', docId: 'menu', content: 'מרכיבי המבורגר', embedding: [0, 1] }),
      chunk({ docTitle: 'סגירת גריל', docId: 'grill', content: 'סוגרים את שסתום הגז' }),
    ]
    // Query orthogonal to the one embedded chunk, so the vector arm comes back empty.
    const { selected, mode, vectorArmEmpty, unembeddedChunks } = retrieveGrounding(
      chunks,
      'איך סוגרים את הגריל?',
      [[1, 0]],
    )
    expect(mode).toBe('hybrid')
    expect(vectorArmEmpty).toBe(true)
    expect(unembeddedChunks).toBe(1)
    expect(selected.map((s) => s.docTitle)).toEqual(['סגירת גריל'])
  })

  it('still grounds nothing on a complete index — the greeting behaviour is unchanged', () => {
    const chunks = [
      chunk({
        docTitle: 'משמרות',
        docId: 'shifts',
        content: 'משמרת בוקר מתחילה בשבע',
        embedding: [0, 1],
      }),
    ]
    const { block, selected, vectorArmEmpty, unembeddedChunks } = retrieveGrounding(
      chunks,
      'בוקר טוב, מה נשמע?',
      [[1, 0]],
    )
    expect(selected).toEqual([])
    expect(block).toBe('')
    expect(vectorArmEmpty).toBe(true)
    expect(unembeddedChunks).toBe(0)
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

describe('resolveQuery — contentless follow-ups', () => {
  // Measured on the live index: six unrelated contentless turns ('עוד', 'תסביר', 'ok', 'המשך',
  // 'more please', 'אהה') all returned the SAME documents, and they were the six largest files in
  // the corpus. With no signal to match, ranking falls back to bulk — a document cut into fourteen
  // chunks gets fourteen chances to look vaguely close to anything. That is how a thread about the
  // branch-opening checklist answered out of the lease dashboard two turns later.
  it('searches for the thread anchor, not the empty turn', () => {
    expect(resolveQuery('עוד', ['מהו נוהל הפתיחה?'])).toEqual({
      question: 'מהו נוהל הפתיחה?',
      texts: ['מהו נוהל הפתיחה?'],
    })
  })

  it('walks back past a run of empty turns to the last one that said something', () => {
    // The real client chain: the question, then 'תסביר', then 'עוד'. Looking only one turn back
    // lands on 'תסביר', which is just as empty as 'עוד'.
    expect(resolveQuery('עוד', ['מהו נוהל הפתיחה?', 'תסביר']).question).toBe('מהו נוהל הפתיחה?')
  })

  it('sends the anchor ALONE, never the anchor with the empty turn appended', () => {
    // Measured: `${anchor}\n${question}` still drifted to the dashboards. Appending the empty turn
    // moves the embedding off the anchor's meaning, so the prefix trick cannot rescue this case.
    expect(resolveQuery('תסביר', ['מהו נוהל הפתיחה?']).texts).toEqual(['מהו נוהל הפתיחה?'])
  })

  it('leaves a follow-up that carries content alone, and still prefixes the previous turn', () => {
    expect(resolveQuery('ומה לגבי הביטוח?', ['מהו נוהל הפתיחה?', 'תסביר'])).toEqual({
      question: 'ומה לגבי הביטוח?',
      texts: ['ומה לגבי הביטוח?', 'תסביר\nומה לגבי הביטוח?'],
    })
  })

  it('does not rewrite the first turn of a thread, even if it is a filler word', () => {
    // Nothing to return to: there is no anchor behind it, so it retrieves as it always did.
    expect(resolveQuery('עוד', [])).toEqual({ question: 'עוד', texts: ['עוד'] })
  })

  it('treats an English continuation the same way', () => {
    expect(
      resolveQuery('explain more please', ['What is on the branch opening checklist?']),
    ).toEqual({
      question: 'What is on the branch opening checklist?',
      texts: ['What is on the branch opening checklist?'],
    })
  })

  it('does not mistake a real question for filler because it is short', () => {
    // 'מה המשימות שלי?' tokenizes to ['המשימות'] — one word, but a content word.
    expect(resolveQuery('מה המשימות שלי?', ['מהו נוהל הפתיחה?']).question).toBe('מה המשימות שלי?')
  })
})
