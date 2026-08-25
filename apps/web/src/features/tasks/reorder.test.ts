import type { Task } from '@burgers/shared'
import { describe, expect, it } from 'vitest'
import { applyReorder } from './reorder.js'

// The pure drag→command computation behind Slice D's board (#135). The DnD wiring in tasks-screen is
// thin — it hands this function the displayed board plus the two ids a drop names, and this decides
// both the optimistic board and the API command. Reorder is per-location (position is the shared
// per-location order), so a drag only ever rewrites the dragged task's own location: a manager's
// single-location board reorders whole, an admin's chain-wide board reorders that one branch group
// and leaves the others untouched. These cases pin exactly that, with no DOM or dnd-kit in sight.

const task = (id: string, locationId: string, position: number): Task => ({
  id,
  locationId,
  title: id,
  description: null,
  status: 'not_started',
  priority: 'normal',
  dueDate: null,
  completedAt: null,
  position,
  projectId: null,
  personal: false,
  assignees: [],
  createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'A Manager' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('applyReorder', () => {
  it('moves a task later within a single-location board and rewrites every position', () => {
    // A manager's board: one location, positions 0,1,2. Drag "a" onto "c"'s slot → [b, c, a].
    const board = [task('a', 'loc-1', 0), task('b', 'loc-1', 1), task('c', 'loc-1', 2)]

    const result = applyReorder(board, 'a', 'c')

    if (result === null) throw new Error('expected a reorder result')
    // The command carries the whole location in its new order, and no explicit locationId is needed
    // here — but the helper always names the affected location so an admin path works the same way.
    expect(result.command).toEqual({ orderedIds: ['b', 'c', 'a'], locationId: 'loc-1' })
    // The optimistic board is in the new order with positions reindexed from zero.
    expect(ids(result.tasks)).toEqual(['b', 'c', 'a'])
    expect(result.tasks.map((t) => t.position)).toEqual([0, 1, 2])
  })

  it('moves a task earlier', () => {
    const board = [task('a', 'loc-1', 0), task('b', 'loc-1', 1), task('c', 'loc-1', 2)]
    const result = applyReorder(board, 'c', 'a')
    if (result === null) throw new Error('expected a reorder result')
    expect(result.command).toEqual({ orderedIds: ['c', 'a', 'b'], locationId: 'loc-1' })
    expect(ids(result.tasks)).toEqual(['c', 'a', 'b'])
  })

  it('reorders only the dragged task’s location on an admin chain board, leaving others untouched', () => {
    // An admin sees two branches interleaved by position. Dragging a loc-1 task must reorder only
    // loc-1's group; loc-2's tasks and their positions are never rewritten.
    const board = [
      task('a1', 'loc-1', 0),
      task('b1', 'loc-2', 0),
      task('a2', 'loc-1', 1),
      task('b2', 'loc-2', 1),
    ]

    const result = applyReorder(board, 'a1', 'a2')

    if (result === null) throw new Error('expected a reorder result')
    expect(result.command).toEqual({ orderedIds: ['a2', 'a1'], locationId: 'loc-1' })
    // loc-2's tasks keep their original positions; loc-1's two are re-indexed within their group.
    const byId = new Map(result.tasks.map((t) => [t.id, t]))
    expect(byId.get('a2')?.position).toBe(0)
    expect(byId.get('a1')?.position).toBe(1)
    expect(byId.get('b1')?.position).toBe(0)
    expect(byId.get('b2')?.position).toBe(1)
    // The whole board is returned in the shared manual order (position, id tiebreak).
    expect(ids(result.tasks)).toEqual(['a2', 'b1', 'a1', 'b2'])
  })

  it('returns null for a no-op drop onto the same task', () => {
    const board = [task('a', 'loc-1', 0), task('b', 'loc-1', 1)]
    expect(applyReorder(board, 'a', 'a')).toBeNull()
  })

  it('returns null when either id is not on the board', () => {
    const board = [task('a', 'loc-1', 0), task('b', 'loc-1', 1)]
    expect(applyReorder(board, 'a', 'ghost')).toBeNull()
    expect(applyReorder(board, 'ghost', 'b')).toBeNull()
  })
})
