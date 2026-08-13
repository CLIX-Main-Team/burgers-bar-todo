import { describe, expect, it } from 'vitest'
import { CHUNK_TARGET_CHARS, chunkDocContent } from '../src/assistant/chunking.js'

// The chunker is the pure base of the retrieval index (ADR-0025): structural splitting,
// deterministic, no I/O. These cases pin the packing invariants the index relies on — order
// preserved, nothing lost, near-target sizes, no stray undersized tail. Sizes may exceed the
// target only by the tail-merge tolerance, and joins may add whitespace, so content
// preservation is asserted whitespace-normalized.

// A merged tail can push a chunk past the target by up to the merge threshold plus glue.
const MAX_CHUNK_CHARS = CHUNK_TARGET_CHARS + 400 + 2

const squash = (text: string): string => text.replace(/\s+/g, '')

describe('chunkDocContent (ADR-0025)', () => {
  it('yields no chunks for empty or whitespace-only content', () => {
    expect(chunkDocContent('')).toEqual([])
    expect(chunkDocContent('   \n\n  ')).toEqual([])
  })

  it('keeps a short doc as a single chunk', () => {
    const content = 'צק ליסט פתיחת סניף\n\nשלב 1: הסכם שכירות\nשלב 2: ביטוח'
    expect(chunkDocContent(content)).toEqual([content])
  })

  it('packs paragraphs whole while they fit, splitting only at blank-line boundaries', () => {
    const a = `A${'a'.repeat(799)}`
    const b = `B${'b'.repeat(799)}`
    const c = `C${'c'.repeat(799)}`
    // a+b fit together under the target; c would overflow, so it starts the next chunk.
    expect(chunkDocContent([a, b, c].join('\n\n'))).toEqual([`${a}\n\n${b}`, c])
  })

  it('splits an oversized paragraph by lines, preserving order and losing nothing', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `שורה ${i}: ${'x'.repeat(90)}`)
    const chunks = chunkDocContent(lines.join('\n'))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
    expect(squash(chunks.join(''))).toBe(squash(lines.join('')))
  })

  it('hard-cuts a single line that alone exceeds the target, losing nothing', () => {
    const monster = 'y'.repeat(CHUNK_TARGET_CHARS * 2 + 100)
    const chunks = chunkDocContent(monster)
    // Two full cuts plus a 100-char remainder, which the tail merge folds into the second.
    expect(chunks.length).toBe(2)
    expect(squash(chunks.join(''))).toBe(monster)
  })

  it('merges an undersized tail into the previous chunk', () => {
    const big = 'z'.repeat(1_700)
    const tiny = 'סוף קצר'
    const chunks = chunkDocContent(`${big}\n\n${tiny}`)
    expect(chunks).toEqual([`${big}\n\n${tiny}`])
  })

  it('is deterministic: the same content chunks identically twice', () => {
    const content = Array.from({ length: 60 }, (_, i) => `row ${i}: ${'q'.repeat(50)}`).join('\n')
    expect(chunkDocContent(content)).toEqual(chunkDocContent(content))
  })
})
