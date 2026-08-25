import type { Task } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import {
  ANY_FILTER,
  BACKLOG_FILTER,
  type TaskLenses,
  applyLenses,
  hasActiveLens,
} from './task-filters.js'

// The per-viewer lenses the v2 toolbar drives (scope tabs, branch and assignee filters, the
// search). They compose, so the cases that matter are the interactions — a scope that survives a
// branch filter, a backlog filter that is not "no filter" — rather than each one alone.

const YAEL = 'aaaaaaaa-0001-4001-8001-aaaaaaaaaaaa'
const NOA = 'aaaaaaaa-0002-4002-8002-aaaaaaaaaaaa'
const DIZENGOFF = 'bbbbbbbb-0001-4001-8001-bbbbbbbbbbbb'
const ASHDOD = 'bbbbbbbb-0002-4002-8002-bbbbbbbbbbbb'

const task = (
  id: string,
  overrides: Partial<Pick<Task, 'title' | 'locationId' | 'assignees' | 'personal'>> = {},
): Task => ({
  id,
  locationId: DIZENGOFF,
  title: id,
  description: null,
  status: 'not_started',
  priority: 'normal',
  dueDate: null,
  completedAt: null,
  position: 0,
  projectId: null,
  personal: false,
  assignees: [],
  createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'A Manager' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const assignee = (id: string, displayName: string) => ({
  id,
  displayName,
  assignedAt: '2026-01-01T00:00:00.000Z',
})

const lenses = (overrides: Partial<TaskLenses> = {}): TaskLenses => ({
  scope: 'all',
  branchId: ANY_FILTER,
  assigneeId: ANY_FILTER,
  role: ANY_FILTER,
  term: '',
  ...overrides,
})

const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('task lenses', () => {
  const board = [
    task('mine-dizengoff', { assignees: [assignee(YAEL, 'Yael')] }),
    task('noas-dizengoff', { assignees: [assignee(NOA, 'Noa')] }),
    task('mine-ashdod', { locationId: ASHDOD, assignees: [assignee(YAEL, 'Yael')] }),
    task('backlog-dizengoff'),
    // Private work (2026-08-25): the API only ever sends the viewer their own, and it carries no
    // branch, so the shared board must not show it under any combination of lenses.
    task('my-private-note', {
      personal: true,
      locationId: null,
      assignees: [assignee(YAEL, 'Yael')],
    }),
  ]

  it('passes every shared task through when nothing is chosen, and no private one', () => {
    expect(ids(applyLenses(board, lenses()))).toEqual([
      'mine-dizengoff',
      'noas-dizengoff',
      'mine-ashdod',
      'backlog-dizengoff',
    ])
    expect(hasActiveLens(lenses())).toBe(false)
  })

  it('shows the private board on the personal scope, and only it', () => {
    expect(ids(applyLenses(board, lenses({ scope: 'personal' })))).toEqual(['my-private-note'])
  })

  it('keeps private work off the shared board however it is narrowed', () => {
    // The private row is assigned to Yael and would pass an assignee lens on its own merits; the
    // split is what has to hold, or somebody's notes would appear mid-shift.
    for (const narrowing of [{ assigneeId: YAEL }, { term: 'my-private' }]) {
      expect(ids(applyLenses(board, lenses(narrowing)))).not.toContain('my-private-note')
    }
  })

  it('treats the backlog as a real filter, not the absence of one', () => {
    expect(ids(applyLenses(board, lenses({ assigneeId: BACKLOG_FILTER })))).toEqual([
      'backlog-dizengoff',
    ])
    expect(hasActiveLens(lenses({ assigneeId: BACKLOG_FILTER }))).toBe(true)
  })

  it('filters to one person without claiming their sole ownership', () => {
    const shared = task('shared', {
      assignees: [assignee(YAEL, 'Yael'), assignee(NOA, 'Noa')],
    })
    expect(ids(applyLenses([...board, shared], lenses({ assigneeId: NOA })))).toEqual([
      'noas-dizengoff',
      'shared',
    ])
  })

  it('matches the search case-insensitively against the title only', () => {
    const named = [task('a', { title: 'Grill station opening' }), task('b', { title: 'Stock' })]
    expect(ids(applyLenses(named, lenses({ term: 'grill' })))).toEqual(['a'])
  })

  it('counts each tab against the other lenses, so a number survives being pressed', () => {
    // What the screen does to label the tabs: run the same lenses at each scope. Filtered to
    // Ashdod the shared board holds one task, and the private board — which carries no branch —
    // holds none, rather than advertising a count the tab would not deliver.
    const inAshdod = lenses({ branchId: ASHDOD })
    expect(applyLenses(board, { ...inAshdod, scope: 'all' })).toHaveLength(1)
    expect(applyLenses(board, { ...inAshdod, scope: 'personal' })).toHaveLength(0)
  })
})
