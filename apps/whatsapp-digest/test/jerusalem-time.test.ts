import { describe, expect, it } from 'vitest'
import { SATURDAY, jerusalemWallClock } from '../src/jerusalem-time.js'

// The weekday the scheduler's rest-day rule reads. It has to come from the Jerusalem calendar, not
// the UTC one: the two disagree for the first three hours of every Israeli day.

describe('jerusalemWallClock weekday', () => {
  it('reads Saturday at the fire hour', () => {
    // 05:00Z is 08:00 in Jerusalem during Israeli summer time.
    const wall = jerusalemWallClock(new Date('2026-09-19T05:00:00Z'))
    expect(wall).toMatchObject({ date: '2026-09-19', hour: 8, weekday: SATURDAY })
  })

  it('is already Saturday in Jerusalem while UTC is still Friday night', () => {
    // 22:00Z Friday is 01:00 Saturday in Jerusalem. A UTC weekday here would let a digest out.
    const wall = jerusalemWallClock(new Date('2026-09-18T22:00:00Z'))
    expect(wall.date).toBe('2026-09-19')
    expect(wall.weekday).toBe(SATURDAY)
  })

  it('numbers the week like Date.getDay, Sunday 0 through Saturday 6', () => {
    expect(jerusalemWallClock(new Date('2026-09-20T05:00:00Z')).weekday).toBe(0)
    expect(jerusalemWallClock(new Date('2026-09-18T05:00:00Z')).weekday).toBe(5)
    expect(SATURDAY).toBe(6)
  })
})
