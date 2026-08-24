import type { Task, TaskPriority, TaskStatus } from '@burgers/shared'
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

export interface PersonLoad {
  userId: string
  name: string
  open: number
  done: number
  total: number
  /** How many of this person's open tasks are already past their due date. */
  overdue: number
}

// Who is carrying the shift. Ranked by how much each person has LEFT rather than by how much
// they hold in total, because the question a manager asks at 14:00 is "who needs a hand", and
// someone holding eight finished tasks needs nothing.
//
// A task with several assignees counts once for each of them: the point is each person's own
// plate, so the column deliberately does not sum to the board's total. Unassigned tasks appear
// nowhere here — they are nobody's load, and the board's own backlog chip is where they belong.
export function assigneeLoad(tasks: Task[], now: Date): PersonLoad[] {
  const rows = new Map<string, PersonLoad>()
  for (const task of tasks) {
    const late = isOverdue(task.dueDate, task.status, now)
    for (const person of task.assignees) {
      const row = rows.get(person.id) ?? {
        userId: person.id,
        name: person.displayName,
        open: 0,
        done: 0,
        total: 0,
        overdue: 0,
      }
      row.total += 1
      if (task.status === 'done') row.done += 1
      else row.open += 1
      if (late) row.overdue += 1
      rows.set(person.id, row)
    }
  }

  // Whoever is late comes first, because a late task is the one thing on this card that asks
  // for something; the plain open count orders everyone else.
  return [...rows.values()].sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name),
  )
}

// --- What the redesigned Home screen adds (round 11, 2026-08-23) ---

// High first: the donut and the legend both read top-down as "what is worth the most", and a
// reader looking for the urgent slice should not have to hunt past the default tier to find it.
const PRIORITY_ORDER = ['high', 'medium', 'normal'] as const satisfies TaskPriority[]

export interface PriorityMix {
  priority: TaskPriority
  count: number
}

// The priority split of what is LEFT, never of the whole board.
//
// This is the second question the screen asks, and it is a genuinely different one from status:
// status says where a task IS, priority says what it is WORTH (the same split priority.ts draws).
// A board can be 70% done and still be carrying every high-priority job it started with, and no
// completion ring can show that.
//
// Finished tasks are excluded on the same rule the due-date figures follow: the priority of a
// job already done is history, and counting it would let a shift look heavier than it is.
export function priorityMix(tasks: Task[]): PriorityMix[] {
  const open = tasks.filter((task) => task.status !== 'done')
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    count: open.filter((task) => task.priority === priority).length,
  }))
}

export interface BranchBreakdown {
  locationId: string
  name: string
  notStarted: number
  inProgress: number
  done: number
  total: number
  overdue: number
  percent: number
}

// Every branch as its own three-part bar, rather than the single completion figure the round-10
// league table ranked on. The split is the point: two branches both sitting at 40% done are not
// in the same shape if one has the rest in progress and the other has not started any of it.
//
// Ordered by what needs a manager, not by who is winning — most overdue first, then least
// finished. A league table answers "who is best"; this screen is opened to answer "where do I
// go first", so the branch in trouble is the one at the top. A branch whose name has not loaded
// is left out rather than shown against a raw id, the same rule branchProgress follows.
export function branchBreakdown(
  tasks: Task[],
  names: Map<string, string>,
  now: Date,
): BranchBreakdown[] {
  const rows = new Map<string, Omit<BranchBreakdown, 'locationId' | 'name' | 'percent'>>()
  for (const task of tasks) {
    const row = rows.get(task.locationId) ?? {
      notStarted: 0,
      inProgress: 0,
      done: 0,
      total: 0,
      overdue: 0,
    }
    row.total += 1
    if (task.status === 'done') row.done += 1
    else if (task.status === 'in_progress') row.inProgress += 1
    else row.notStarted += 1
    if (isOverdue(task.dueDate, task.status, now)) row.overdue += 1
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
          ...row,
          percent: row.total === 0 ? 0 : Math.round((row.done / row.total) * 100),
        },
      ]
    })
    .sort((a, b) => b.overdue - a.overdue || a.percent - b.percent || a.name.localeCompare(b.name))
}

export interface Page<T> {
  rows: T[]
  /** The page actually shown, after clamping. 1-based. */
  page: number
  pageCount: number
  /** The 1-based range this page covers, for the "1–10 of 47" line. Both 0 on an empty list. */
  from: number
  to: number
  total: number
}

// One page of a list, with the requested page clamped into range.
//
// The clamp is the whole reason this is a function rather than a slice at the call site: the
// table's filters and its pager are independent controls, so narrowing to a branch with four
// tasks while sitting on page five must land the reader on the last real page, never on a blank
// one that looks like an empty result.
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const total = items.length
  const pageCount = Math.max(Math.ceil(total / size), 1)
  const current = Math.min(Math.max(page, 1), pageCount)
  const start = (current - 1) * size
  const rows = items.slice(start, start + size)
  return {
    rows,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + rows.length,
    total,
  }
}
