import type { Task, TaskStatus } from '@burgers/shared'
import { dueDay, isOverdue } from '../tasks/due-date.js'

// What the Home screen counts, derived from the very same board read the Tasks screen makes
// (round 10, 2026-08-21). Nothing here fetches: the screen owns the query and hands the task
// list in, so these are pure functions a test can drive with a literal array.
//
// The point of keeping them apart from the screen is that a dashboard's honesty lives in its
// arithmetic. "Overdue" and "due today" are the two figures a shift manager acts on, and both
// are already defined once, in the board's own due-date module — reused here rather than
// re-derived, so a task that reads overdue on a card can never read on-time on Home.

export interface ShiftMetrics {
  total: number
  done: number
  inProgress: number
  notStarted: number
  /** Everything not yet done — what is actually left on the shift. */
  open: number
  dueToday: number
  /** Past its due date and still not done. Never counts a finished task. */
  overdue: number
  /** 0–100, rounded. An empty board is 0, not NaN. */
  percentDone: number
}

export function shiftMetrics(tasks: Task[], now: Date): ShiftMetrics {
  const byStatus = (status: TaskStatus) => tasks.filter((task) => task.status === status).length
  const done = byStatus('done')
  const total = tasks.length

  return {
    total,
    done,
    inProgress: byStatus('in_progress'),
    notStarted: byStatus('not_started'),
    open: total - done,
    // A due date on a finished task is history, so both time figures ignore done tasks.
    dueToday: tasks.filter(
      (task) => task.status !== 'done' && task.dueDate && dueDay(task.dueDate, now) === 'today',
    ).length,
    overdue: tasks.filter((task) => isOverdue(task.dueDate, task.status, now)).length,
    percentDone: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

export interface BranchProgress {
  locationId: string
  name: string
  done: number
  total: number
  percent: number
}

// The chain-wide comparison, for the one viewer whose board actually mixes branches. It is real
// data, not a fixture: an admin's board read already carries every branch's tasks, and the
// Locations read already carries the names, so the only work left is the grouping.
//
// Sorted by completion descending (the ranking IS the insight — a table nobody can rank is a
// list), with the branch name as a stable tiebreak so two branches on the same percentage do
// not swap places between renders. A task whose branch name has not loaded yet is left out
// rather than shown against a raw id.
export function branchProgress(tasks: Task[], names: Map<string, string>): BranchProgress[] {
  const rows = new Map<string, { done: number; total: number }>()
  for (const task of tasks) {
    const row = rows.get(task.locationId) ?? { done: 0, total: 0 }
    row.total += 1
    if (task.status === 'done') row.done += 1
    rows.set(task.locationId, row)
  }

  return [...rows]
    .flatMap(([locationId, row]) => {
      const name = names.get(locationId)
      if (!name) return []
      return [
        {
          locationId,
          name,
          done: row.done,
          total: row.total,
          percent: row.total === 0 ? 0 : Math.round((row.done / row.total) * 100),
        },
      ]
    })
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
}

export interface PersonLoad {
  userId: string
  name: string
  open: number
  done: number
  total: number
}

// Who is carrying the shift. Ranked by how much each person has LEFT rather than by how much
// they hold in total, because the question a manager asks at 14:00 is "who needs a hand", and
// someone holding eight finished tasks needs nothing.
//
// A task with several assignees counts once for each of them: the point is each person's own
// plate, so the column deliberately does not sum to the board's total. Unassigned tasks appear
// nowhere here — they are nobody's load, and the board's own backlog chip is where they belong.
export function assigneeLoad(tasks: Task[]): PersonLoad[] {
  const rows = new Map<string, PersonLoad>()
  for (const task of tasks) {
    for (const person of task.assignees) {
      const row = rows.get(person.id) ?? {
        userId: person.id,
        name: person.displayName,
        open: 0,
        done: 0,
        total: 0,
      }
      row.total += 1
      if (task.status === 'done') row.done += 1
      else row.open += 1
      rows.set(person.id, row)
    }
  }

  return [...rows.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
}
