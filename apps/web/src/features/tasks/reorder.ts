import type { ReorderTasksRequest, Task } from '@burgers/shared'
import { byManualOrder } from './board-stream.js'

// The optimistic board and the API command a single drag produces (#135, Slice D). Kept apart from
// the DnD wiring so the ordering logic is unit-reasonable without a DOM: the screen owns dnd-kit and
// the cache, this owns "what does dropping `activeId` on `overId` mean".
export interface ReorderResult {
  // The whole board with the affected location's positions rewritten, in the shared manual order
  // (position, id tiebreak) — dropped straight into the query cache so the move shows at once, ahead
  // of the server round-trip and the live event that will re-confirm it.
  tasks: Task[]
  // The reorder to POST: the affected location's task ids in their new relative order, and that
  // location. `position` is per-location, so a drag rewrites only the dragged task's own board.
  command: ReorderTasksRequest
}

// Resolve a drag of `activeId` onto `overId`'s slot, over the board as currently displayed (which is
// the shared manual order — drag is disabled while the priority lens is on, so `displayed` is never
// the sorted copy). Returns null for a no-op (same slot) or an id naming no task on the board, so the
// caller neither patches the cache nor calls the API for a move that changes nothing.
//
// Reorder is per-location: only the dragged task's location group is reindexed, and the command names
// just that group. A manager's board is one location, so this reorders the whole of it; an admin's
// chain-wide board reorders the one branch the dragged task belongs to and leaves the rest exactly as
// they were — an order can never name a task on another location (the API refuses one that does).
export function applyReorder(
  displayed: Task[],
  activeId: string,
  overId: string,
): ReorderResult | null {
  if (activeId === overId) return null

  const from = displayed.findIndex((t) => t.id === activeId)
  const to = displayed.findIndex((t) => t.id === overId)
  if (from < 0 || to < 0) return null

  const moved = displayed[from]
  if (!moved) return null
  const locationId = moved.locationId

  // Move the dragged task to the drop slot within the full displayed order (an in-place arrayMove).
  const next = [...displayed]
  next.splice(from, 1)
  next.splice(to, 0, moved)

  // The affected location's tasks, in their new relative order within that move — this is the order
  // the server writes as `position` 0..n-1, and the command we send.
  const orderedIds = next.filter((t) => t.locationId === locationId).map((t) => t.id)

  // Mirror the server's write locally: reindex only this location's tasks to their new position,
  // leaving every other location's tasks (and positions) untouched, then re-sort by the same manual
  // order the board and the live channel use — so the optimistic cache matches what a fresh read, or
  // the reorder's own live events, will bring back.
  const positionById = new Map(orderedIds.map((id, index) => [id, index]))
  const tasks = next
    .map((t) =>
      t.locationId === locationId ? { ...t, position: positionById.get(t.id) ?? t.position } : t,
    )
    .sort(byManualOrder)

  return { tasks, command: { orderedIds, locationId } }
}
