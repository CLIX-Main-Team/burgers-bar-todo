import { describe, expect, it } from 'vitest'
import { monotonePath, niceMax } from './chart-geometry.js'

// The activity chart's geometry. The two things a smooth line must never do are the ones worth
// pinning: bulge past a real peak (a curve that reads 13 where the day was 12 is a lie), and dip
// below the baseline between two quiet days (a negative count is impossible).

const coordinates = (path: string) =>
  path
    .replace(/[MC]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .map(Number)

describe('monotonePath', () => {
  it('starts at the first point and ends at the last', () => {
    const path = monotonePath([
      [0, 50],
      [10, 20],
      [20, 40],
    ])

    expect(path.startsWith('M0,50')).toBe(true)
    expect(path.endsWith('20,40')).toBe(true)
  })

  it('draws one cubic per segment', () => {
    const path = monotonePath([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 40],
    ])

    expect(path.match(/C/g)).toHaveLength(3)
  })

  it('keeps a flat run flat, so a quiet stretch never grows a bump', () => {
    const ys = coordinates(
      monotonePath([
        [0, 80],
        [10, 80],
        [20, 80],
      ]),
    ).filter((_, index) => index % 2 === 1)

    expect(new Set(ys)).toEqual(new Set([80]))
  })

  it('never overshoots a peak or dips under the baseline', () => {
    // y grows downward in SVG: 100 is the baseline, 20 the peak.
    const ys = coordinates(
      monotonePath([
        [0, 100],
        [10, 100],
        [20, 20],
        [30, 100],
        [40, 100],
      ]),
    ).filter((_, index) => index % 2 === 1)

    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20)
    expect(Math.max(...ys)).toBeLessThanOrEqual(100)
  })

  it('returns an empty path for fewer than two points', () => {
    expect(monotonePath([])).toBe('')
    expect(monotonePath([[0, 0]])).toBe('')
  })
})

describe('niceMax', () => {
  it('lands the four grid steps on round numbers', () => {
    expect(niceMax(0)).toBe(4)
    expect(niceMax(3)).toBe(4)
    expect(niceMax(13)).toBe(16)
    expect(niceMax(17)).toBe(20)
    expect(niceMax(21)).toBe(40)
    expect(niceMax(101)).toBe(120)
  })
})
