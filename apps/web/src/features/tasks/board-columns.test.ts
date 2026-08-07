import type { Task, TaskStatus } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { STATUS_ORDER, type StatusColumn, groupByStatus, resolveDrop } from './board-columns.js'

// The pure lane model and drag resolution behind the kanban (#214). The DnD wiring in status-board
// is thin — it hands these the grouped lanes and the two ids a drop names, and these decide which
// lane a task sits in and whether a drop is a status change, a reorder, or nothing. These cases pin
// exactly that, with no DOM or dnd-kit in sight.

const task = (id: string, status: Task['status'], position: number): Task => ({
  id,
  locationId: 'loc-1',
  title: id,
  description: null,
  status,
  priority: 'normal',
  dueDate: null,
  completedAt: null,
  position,
  assignees: [],
  createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'A Manager' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

// A lane's task ids by status, so a test never indexes the columns array by position (which
// noUncheckedIndexedAccess would flag as possibly-undefined) and reads by the status it means.
const lane = (columns: StatusColumn[], status: TaskStatus) =>
  columns.find((c) => c.status === status)?.tasks.map((t) => t.id) ?? []

describe('groupByStatus', () => {
  it('splits the board into the three lanes in the fixed order', () => {
    const columns = groupByStatus([
      task('a', 'done', 0),
      task('b', 'not_started', 1),
      task('c', 'in_progress', 2),
    ])
    expect(columns.map((c) => c.status)).toEqual(STATUS_ORDER)
    expect(lane(columns, 'not_started')).toEqual(['b'])
    expect(lane(columns, 'in_progress')).toEqual(['c'])
    expect(lane(columns, 'done')).toEqual(['a'])
  })

  it('preserves the incoming order within a lane (filter is stable)', () => {
    const columns = groupByStatus([
      task('a', 'not_started', 0),
      task('b', 'in_progress', 1),
      task('c', 'not_started', 2),
      task('d', 'not_started', 3),
    ])
    expect(lane(columns, 'not_started')).toEqual(['a', 'c', 'd'])
  })

  it('renders a lane with no tasks as an empty column, never dropping it', () => {
    const columns = groupByStatus([task('a', 'not_started', 0)])
    expect(columns).toHaveLength(3)
    expect(lane(columns, 'in_progress')).toEqual([])
    expect(lane(columns, 'done')).toEqual([])
  })
})

describe('resolveDrop', () => {
  const board = [
    task('a', 'not_started', 0),
    task('b', 'not_started', 1),
    task('c', 'in_progress', 0),
  ]

  it('reads a drop onto a card in another lane as a status change to that lane', () => {
    expect(resolveDrop(board, 'a', 'c')).toEqual({
      kind: 'status',
      taskId: 'a',
      status: 'in_progress',
    })
  })

  it('reads a drop onto an empty lane (the lane droppable) as a status change to it', () => {
    // The lane's droppable id is the status string; no card is under the pointer.
    expect(resolveDrop(board, 'a', 'done')).toEqual({
      kind: 'status',
      taskId: 'a',
      status: 'done',
    })
  })

  it('reads a drop onto another card in the same lane as a reorder', () => {
    expect(resolveDrop(board, 'a', 'b')).toEqual({ kind: 'reorder', activeId: 'a', overId: 'b' })
  })

  it('is a no-op dropping onto the task’s own lane with no card target', () => {
    expect(resolveDrop(board, 'a', 'not_started')).toBeNull()
  })

  it('is a no-op dropping onto its own card, or naming a task not on the board', () => {
    expect(resolveDrop(board, 'a', 'a')).toBeNull()
    expect(resolveDrop(board, 'ghost', 'b')).toBeNull()
    expect(resolveDrop(board, 'a', 'ghost')).toBeNull()
  })
})
