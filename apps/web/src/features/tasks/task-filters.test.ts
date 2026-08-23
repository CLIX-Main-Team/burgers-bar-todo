import type { Task } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import {
  ANY_FILTER,
  BACKLOG_FILTER,
  type TaskLenses,
  applyLenses,
  countAssignedTo,
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
  overrides: Partial<Pick<Task, 'title' | 'locationId' | 'assignees'>> = {},
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
  userId: YAEL,
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
  ]

  it('passes every task through when nothing is chosen', () => {
    expect(applyLenses(board, lenses())).toHaveLength(4)
    expect(hasActiveLens(lenses())).toBe(false)
  })

  it('narrows to the viewer for the personal scope', () => {
    expect(ids(applyLenses(board, lenses({ scope: 'personal' })))).toEqual([
      'mine-dizengoff',
      'mine-ashdod',
    ])
  })

  it('leaves the personal scope empty rather than wide open when there is no principal yet', () => {
    // The safe direction: an unresolved principal owns nothing, so the board reads empty for a
    // moment instead of flashing every task as if it were the viewer's own.
    expect(applyLenses(board, lenses({ scope: 'personal', userId: undefined }))).toEqual([])
  })

  it('composes the scope with a branch filter rather than either winning', () => {
    const narrowed = applyLenses(board, lenses({ scope: 'personal', branchId: ASHDOD }))
    expect(ids(narrowed)).toEqual(['mine-ashdod'])
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

  it('counts the viewer’s own tasks within what the other lenses already left', () => {
    const inAshdod = applyLenses(board, lenses({ branchId: ASHDOD }))
    // One of the two Ashdod-filtered tasks is Yael's, so the tab reads 1 and not the 2 she owns
    // across the chain — the number has to survive being pressed.
    expect(countAssignedTo(inAshdod, YAEL)).toBe(1)
  })
})
