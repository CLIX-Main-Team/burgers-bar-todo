import { describe, expect, it } from 'vitest'
import { daysUntil, dueDay, isOverdue } from './due-date.js'

// The board's due-date reading (v2 handoff §4). The cases that matter are the boundaries —
// a task due later today is not overdue, and a time-of-day difference must never move a date
// across midnight — since those are what a shift acts on.

const at = (local: string) => new Date(local).toISOString()

describe('due dates', () => {
  // Mid-afternoon, so every case below has hours on both sides of it to get wrong.
  const now = new Date('2026-08-20T16:30:00')

  it('names today and tomorrow, and leaves the rest to the calendar', () => {
    expect(dueDay(at('2026-08-20T08:00:00'), now)).toBe('today')
    expect(dueDay(at('2026-08-21T23:00:00'), now)).toBe('tomorrow')
    expect(dueDay(at('2026-08-22T00:30:00'), now)).toBe('other')
    expect(dueDay(at('2026-08-19T23:59:00'), now)).toBe('other')
  })

  it('counts whole local days, not elapsed hours', () => {
    // Two and a half hours apart, but a day apart on the calendar.
    expect(daysUntil(at('2026-08-21T00:30:00'), new Date('2026-08-20T22:00:00'))).toBe(1)
    // Fourteen hours apart, same day.
    expect(daysUntil(at('2026-08-20T23:00:00'), new Date('2026-08-20T09:00:00'))).toBe(0)
  })

  it('does not call a task due later today overdue', () => {
    expect(isOverdue(at('2026-08-20T09:00:00'), 'not_started', now)).toBe(false)
    expect(isOverdue(at('2026-08-19T09:00:00'), 'not_started', now)).toBe(true)
  })

  it('never marks a finished or undated task overdue', () => {
    expect(isOverdue(at('2026-01-01T09:00:00'), 'done', now)).toBe(false)
    expect(isOverdue(null, 'not_started', now)).toBe(false)
  })
})
