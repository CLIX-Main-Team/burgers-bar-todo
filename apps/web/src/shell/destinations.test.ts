import { type PrincipalResponse, type Role, capabilitiesFor } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import {
  PHONE_TAB_SLOTS,
  destinationsFor,
  firstDestination,
  overflowFor,
  tabsFor,
} from './destinations.js'

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

// The phone bar takes the first four destinations a role holds and More takes the rest. The
// split is positional rather than a flag on any one row, because the Access page lets the owner
// grant and revoke pages per role at run time (owner note 2026-08-30) — so these cases feed it
// arbitrary capability sets, not only the four seeded roles, and check the RULE rather than a
// remembered answer for each role.
describe('the phone tab bar and its More sheet', () => {
  // Typed as the principal's own capability union rather than string[]: the point of these
  // cases is a set the Access page could really produce, and a capability it could not grant
  // should not typecheck here either.
  const withPages = (pages: PrincipalResponse['capabilities']): PrincipalResponse => ({
    ...principal('super_admin'),
    capabilities: pages,
  })
  const tabs = (p: PrincipalResponse) => tabsFor(p).map((row) => row.to)
  const more = (p: PrincipalResponse) => overflowFor(p).map((row) => row.to)

  it('never gives the bar more than four destinations, so More is always the fifth cell', () => {
    for (const role of ['super_admin', 'admin', 'manager', 'employee'] as const) {
      expect(tabsFor(principal(role)).length).toBeLessThanOrEqual(PHONE_TAB_SLOTS)
    }
  })

  it('splits the rail in two without losing or duplicating a destination', () => {
    for (const role of ['super_admin', 'admin', 'manager', 'employee'] as const) {
      const p = principal(role)
      expect([...tabs(p), ...more(p)]).toEqual(rows(role))
    }
  })

  it('takes the first four in charter order, so the chain owner overflows knowledge and locations', () => {
    expect(tabs(principal('super_admin'))).toEqual([
      '/dashboard',
      '/tasks',
      '/projects',
      '/assistant',
    ])
    expect(more(principal('super_admin'))).toEqual(['/knowledge', '/locations'])
  })

  it('leaves the manager the knowledge tab — the phone e2e asserts that row is on the bar', () => {
    // A manager holds no dashboard, so knowledge is their fourth and reaches the bar directly.
    expect(tabs(principal('manager'))).toContain('/knowledge')
  })

  it('gives More nothing to list when a role holds four pages or fewer', () => {
    const employee = principal('employee')
    expect(rows('employee').length).toBeLessThanOrEqual(PHONE_TAB_SLOTS)
    expect(more(employee)).toEqual([])
  })

  it('holds for a capability set the owner invented, not only the seeded roles', () => {
    // One page: a one-destination bar plus More, not a crash or an empty bar.
    const single = withPages(['page.knowledge'])
    expect(tabs(single)).toEqual(['/knowledge'])
    expect(more(single)).toEqual([])

    // Every page revoked: the bar is More alone, and nothing below it goes undefined.
    const none = withPages([])
    expect(tabs(none)).toEqual([])
    expect(more(none)).toEqual([])

    // A set that overflows: still four on the bar, remainder in More, order preserved.
    const many = withPages([
      'page.dashboard',
      'page.tasks',
      'page.projects',
      'page.assistant',
      'page.knowledge',
    ])
    expect(tabs(many)).toHaveLength(PHONE_TAB_SLOTS)
    expect(more(many)).toEqual(['/knowledge'])
  })
})
