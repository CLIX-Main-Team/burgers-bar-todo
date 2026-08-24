import type { UserSummary } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { ONLINE_WINDOW_MS, formatAgo, presenceOf } from './presence.js'

// Presence is the one thing on the roster that changes on its own, so its boundaries are
// pinned here rather than inferred from a rendered row: what counts as online, what a
// deactivated account may never claim, and where each relative-time bucket hands over.

const NOW = Date.parse('2026-08-24T12:00:00.000Z')
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function seen(msAgo: number, status: UserSummary['status'] = 'active') {
  return { status, lastSeenAt: new Date(NOW - msAgo).toISOString() }
}

describe('presenceOf — online window', () => {
  it('reads someone who used the app seconds ago as online', () => {
    expect(presenceOf(seen(5 * 1000), NOW)).toEqual({ kind: 'online' })
  })

  it('holds online right up to the window and drops the moment it is reached', () => {
    expect(presenceOf(seen(ONLINE_WINDOW_MS - 1), NOW)).toEqual({ kind: 'online' })
    expect(presenceOf(seen(ONLINE_WINDOW_MS), NOW)).toEqual({
      kind: 'ago',
      value: 5,
      unit: 'minute',
    })
  })

  it('treats a stamp in the future as clock skew on the reader, not as time travel', () => {
    expect(presenceOf({ status: 'active', lastSeenAt: new Date(NOW + HOUR).toISOString() }, NOW)) //
      .toEqual({ kind: 'online' })
  })
})

describe('presenceOf — only an active account can be online', () => {
  // Deactivation revokes every session the user holds, so a cut-off account cannot be in the
  // app — but its final stamp is still seconds old at that moment, and reporting the person
  // you just removed as "Online" is the reading that would cost the column its credibility.
  it('reports a just-deactivated user by when they were last around, never as online', () => {
    expect(presenceOf(seen(30 * 1000, 'deactivated'), NOW)).toEqual({
      kind: 'ago',
      value: 0,
      unit: 'minute',
    })
  })

  it('still reports how long ago a deactivated user was active', () => {
    expect(presenceOf(seen(3 * DAY, 'deactivated'), NOW)).toEqual({
      kind: 'ago',
      value: 3,
      unit: 'day',
    })
  })

  it('reports an invited user, who has no stamp at all, as never seen', () => {
    expect(presenceOf({ status: 'invited', lastSeenAt: null }, NOW)).toEqual({ kind: 'never' })
  })

  it('reads an unparseable stamp as never seen rather than throwing at the row', () => {
    expect(presenceOf({ status: 'active', lastSeenAt: 'not-a-date' }, NOW)).toEqual({
      kind: 'never',
    })
  })
})

describe('presenceOf — the relative buckets and where they hand over', () => {
  it.each([
    ['minutes below an hour', 59 * MINUTE, { kind: 'ago', value: 59, unit: 'minute' }],
    ['hours from one hour', HOUR, { kind: 'ago', value: 1, unit: 'hour' }],
    ['hours below a day', 23 * HOUR, { kind: 'ago', value: 23, unit: 'hour' }],
    ['days from one day', DAY, { kind: 'ago', value: 1, unit: 'day' }],
    ['days below a month', 29 * DAY, { kind: 'ago', value: 29, unit: 'day' }],
    ['months from thirty days', 30 * DAY, { kind: 'ago', value: 1, unit: 'month' }],
  ])('reports %s', (_label, msAgo, expected) => {
    expect(presenceOf(seen(msAgo), NOW)).toEqual(expected)
  })

  it('rounds down, so a person is never reported as more recent than they were', () => {
    expect(presenceOf(seen(119 * MINUTE), NOW)).toEqual({ kind: 'ago', value: 1, unit: 'hour' })
  })
})

describe('formatAgo', () => {
  it('phrases the elapsed time in the reading language', () => {
    expect(formatAgo({ kind: 'ago', value: 5, unit: 'minute' }, 'en')).toBe('5 minutes ago')
    expect(formatAgo({ kind: 'ago', value: 1, unit: 'day' }, 'en')).toBe('yesterday')
  })

  // The catalogue never spells out Hebrew's plural rules; Intl already holds them, which is
  // the whole reason presence formats through it rather than through a message string. Two
  // days ago is the case that makes the point: Hebrew has a single dedicated word for it
  // (שלשום), which no plural rule a catalogue could carry would ever have produced.
  it('carries Hebrew plurals and idiom without the catalogue owning a rule set', () => {
    expect(formatAgo({ kind: 'ago', value: 5, unit: 'minute' }, 'he')).toContain('דקות')
    expect(formatAgo({ kind: 'ago', value: 1, unit: 'day' }, 'he')).toBe('אתמול')
    expect(formatAgo({ kind: 'ago', value: 2, unit: 'day' }, 'he')).toBe('שלשום')
  })
})
