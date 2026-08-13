import { describe, expect, it } from 'vitest'
import type { KnowledgeChunk } from '../src/assistant/repository.js'
import {
  GROUNDING_TOKEN_BUDGET,
  MAX_GROUNDING_CHUNKS,
  MIN_TOP_SCORE,
  buildQueryTexts,
  retrieveGrounding,
} from '../src/assistant/retrieval.js'

// The retrieval rules (ADR-0025) as pure unit cases: mode choice, ranking, the relevance
// floor, the budget and count caps, and the doc-grouped rendering whose `## title` headings
// extractSources keys citations off (#227). Vectors here are hand-built unit geometry — the
// tests pin the selection mechanics, never a real model's similarity landscape.

const chunk = (over: Partial<KnowledgeChunk> & { docTitle: string }): KnowledgeChunk => ({
  docId: over.docTitle,
  chunkIndex: 0,
  content: `content of ${over.docTitle}`,
  embedding: null,
  ...over,
})

describe('retrieveGrounding — vector mode', () => {
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

  it('grounds nothing when even the best chunk is below the top-score gate — small talk', () => {
    // cosine([1,0], [x, y]) = x for a unit vector: build one just under the gate.
    const x = MIN_TOP_SCORE - 0.02
    const y = Math.sqrt(1 - x * x)
    const chunks = [chunk({ docTitle: 'noise', embedding: [x, y] })]
    const { block, selected } = retrieveGrounding(chunks, 'hey how are you', [[1, 0]])
    expect(selected).toEqual([])
    expect(block).toBe('')
  })

  it('ignores un-embedded chunks in vector mode (they return in keyword mode)', () => {
    const chunks = [
      chunk({ docTitle: 'embedded', embedding: [1, 0] }),
      chunk({ docTitle: 'pending', embedding: null }),
    ]
    const { selected } = retrieveGrounding(chunks, 'q', [[1, 0]])
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

describe('retrieveGrounding — keyword fallback', () => {
  it('falls back to keyword overlap when no query vectors arrived', () => {
    const chunks = [
      chunk({ docTitle: 'הזמנות לחם', content: 'נוהל הזמנת לחמניות לסניף מהמאפייה' }),
      chunk({ docTitle: 'דוח תדלוקים', docId: 'fuel', content: 'רכב 123 תדלק 250 ליטר' }),
    ]
    const { selected } = retrieveGrounding(chunks, 'איך מזמינים לחמניות לסניף?', [])
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
