import { type PrincipalResponse, type Role, capabilitiesFor } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { destinationsFor, firstDestination } from './destinations.js'

// The rail is drawn from the principal's capability list, so the owner's per-page brief of
// 2026-08-25 is testable here as one table: who sees which rows, and where each role lands when
// they open the app. A hidden page has to hide its way in too — a row that 404s or bounces is
// worse than no row.

const principal = (role: Role): PrincipalResponse => ({
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'A Person',
  role,
  locationId: role === 'super_admin' ? null : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  status: 'active',
  capabilities: capabilitiesFor(role),
})

const rows = (role: Role) => destinationsFor(principal(role)).map((row) => row.to)

describe('the rail, per role', () => {
  it('gives the chain owner every destination', () => {
    expect(rows('super_admin')).toEqual([
      '/dashboard',
      '/tasks',
      '/projects',
      '/assistant',
      '/knowledge',
      '/locations',
    ])
  })

  it('gives a branch admin the same rail — theirs is one branch wide, not shorter', () => {
    expect(rows('admin')).toEqual(rows('super_admin'))
  })

  it('keeps the dashboard from a manager, and gives them the branch page read-only', () => {
    // The dashboard reports on a branch to whoever runs it; a manager runs the shift.
    expect(rows('manager')).toEqual([
      '/tasks',
      '/projects',
      '/assistant',
      '/knowledge',
      '/locations',
    ])
  })

  it('leaves an employee the three screens they work in', () => {
    expect(rows('employee')).toEqual(['/tasks', '/projects', '/assistant'])
  })

  it('lands each role on the first page they hold', () => {
    expect(firstDestination(principal('super_admin'))).toBe('/dashboard')
    expect(firstDestination(principal('admin'))).toBe('/dashboard')
    expect(firstDestination(principal('manager'))).toBe('/tasks')
    expect(firstDestination(principal('employee'))).toBe('/tasks')
  })

  it('lands a role stripped of every page on the board rather than looping', () => {
    // The Access page was this backstop until it became the owner's alone (2026-08-25); landing
    // a stripped role there now would bounce them straight back out of it.
    const stripped = { ...principal('employee'), capabilities: [] }
    expect(firstDestination(stripped)).toBe('/tasks')
  })
})
