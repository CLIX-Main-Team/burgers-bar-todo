import type { Task, TaskStatus } from '@burgers/shared'
import type { IconRole } from '../../components/ui/icon-registry.js'

// The kanban's column model and drag resolution, kept apart from the DnD wiring so both are
// unit-reasonable without a DOM (#214, task-board mockup §Column). The board is a single
// manually-ordered list on the wire (position, id tiebreak); the kanban is a *view* over it that
// splits that one order into three status lanes. Nothing here writes — the screen owns the cache
// and the API — this only decides "which lane does a task sit in" and "what does a drop mean".

// The fixed lane order the board shows in both reading directions (RTL places the first at the
// inline-start / right). It is the status enum's own order, so the lanes read Not started → In
// progress → Done left-to-right in English and the mirror in Hebrew.
export const STATUS_ORDER = ['not_started', 'in_progress', 'done'] as const satisfies TaskStatus[]

export interface StatusColumn {
  status: TaskStatus
  tasks: Task[]
}

// The one place a status maps to its registry glyph (as labels.ts is the one place it maps to its
// message key), so a status draws the same mark wherever it appears — the kanban lane head and the
// card's "Move to…" menu. `regular` weight is the resting default; the menu paints the current
// selection `fill` via the Icon `active` prop (iconography.md), never a second map here.
export const STATUS_ICON: Record<TaskStatus, IconRole> = {
  not_started: 'status-not-started',
  in_progress: 'status-in-progress',
  done: 'status-done',
}

// The one place a status maps to its colour, on the dedicated status tokens (owner calls
// 2026-08): warm orange for not-started (swapped with the backlog chip's colour — orange
// reads as "waiting for someone"), the CRM's soft blue for in-progress, its soft green for
// done. Lane heads, the mobile status tabs, and the card's StatusControl pill all read this
// map, so a status wears one colour everywhere it appears.
export const STATUS_TONE: Record<TaskStatus, string> = {
  not_started: 'bg-status-not-started text-status-not-started-foreground',
  in_progress: 'bg-status-in-progress text-status-in-progress-foreground',
  done: 'bg-status-done text-status-done-foreground',
}

// The ink half alone, for surfaces that colour a status word without its tinted surface —
// the tab row's unselected tabs keep their status colour this way (owner feedback 2026-08:
// a status should never read as plain muted text).
export const STATUS_INK: Record<TaskStatus, string> = {
  not_started: 'text-status-not-started-foreground',
  in_progress: 'text-status-in-progress-foreground',
  done: 'text-status-done-foreground',
}

// Split the board into its three status lanes in the fixed order, each carrying that status's
// tasks in the order they arrived. The input is already in the order the lane should show — the
// shared manual order (position ascending) or the priority lens's sorted copy — and filter is
// stable, so grouping never reorders within a lane.
export function groupByStatus(tasks: Task[]): StatusColumn[] {
  return STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  }))
}

// What a drop resolves to on the kanban. A drag ends over either another card (its id) or a whole
// lane (a lane's droppable id is the status string, which no task id can equal — task ids are
// uuids). The two reinterpretations of drag the mockup fixes:
//   - a cross-lane drop → set the dragged task's status to the target lane (the status endpoint)
//   - a within-lane drop onto another card → reorder, keeping the shared `position` (existing path)
// Anything else — a drop onto the task's own slot, onto its own lane with no card under it, or
// naming a task not on the board — is a no-op the screen neither patches nor sends.
export type BoardDrop =
  | { kind: 'status'; taskId: string; status: TaskStatus }
  | { kind: 'reorder'; activeId: string; overId: string }
  | null

function isStatus(id: string): id is TaskStatus {
  return (STATUS_ORDER as readonly string[]).includes(id)
}

// Resolve a drag of `activeId` ending over `overId`, where `overId` is either a lane's status id
// or the id of a card the drop landed on. `tasks` is the whole board (any order) — only used to
// look a task's current status up.
export function resolveDrop(tasks: Task[], activeId: string, overId: string): BoardDrop {
  const active = tasks.find((task) => task.id === activeId)
  if (!active) return null

  // The target lane is named directly when the drop lands on a lane, else taken from the card it
  // landed on. An unknown `overId` (neither a lane nor a card on the board) is a no-op.
  const overTask = isStatus(overId) ? undefined : tasks.find((task) => task.id === overId)
  const target = isStatus(overId) ? overId : overTask?.status
  if (!target) return null

  // Crossing lanes is a status change; the drop's position within the target lane is not written,
  // the moved card takes its existing `position` there (mockup: cross-lane = set status only).
  if (target !== active.status) {
    return { kind: 'status', taskId: activeId, status: target }
  }

  // Same lane: a drop onto a different card is a reorder; onto the lane itself, or onto the card's
  // own slot, changes nothing.
  if (overTask && overId !== activeId) {
    return { kind: 'reorder', activeId, overId }
  }
  return null
}
