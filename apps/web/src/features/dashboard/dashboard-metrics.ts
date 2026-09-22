import type { Task, TaskPriority, TaskStatus } from '@burgers/shared'
import { daysUntil, dueDay, isOverdue } from '../tasks/due-date.js'
import type { SharedTask } from '../tasks/task-filters.js'

// What the Dashboard counts, derived from the very same board read the Tasks screen makes
// (round 10, 2026-08-21; rewritten for round 3 of the redesign, 2026-09-22). Nothing here
// fetches: the screen owns the queries and hands the task list in, so these are pure functions a
// test can drive with a literal array.
//
// The point of keeping them apart from the screen is that a dashboard's honesty lives in its
// arithmetic. "Overdue" and "due today" are the two figures a manager acts on, and both are
// already defined once, in the board's own due-date module, reused here rather than re-derived,
// so a task that reads overdue on a card can never read on time on the dashboard. Every day
// boundary below is the reader's own local midnight, for the same reason.

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

// The branch page's tiles read this one (features/locations/branch-screen.tsx).
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

/** Whole local days since an instant: 0 for today, 1 for yesterday. */
function daysAgo(iso: string, now: Date): number {
  return -daysUntil(iso, now)
}

const isOpen = (task: Task) => task.status !== 'done'

// --- The hero and the overview tiles ---

export interface Overview {
  open: number
  overdue: number
  dueToday: number
  /** Of the tasks due today, how many somebody has already started. */
  dueTodayStarted: number
  inProgress: number
  /** How many places hold work in progress: "34 at 18 branches" says how spread the work is. */
  inProgressPlaces: number
  /** How many whole days the latest open task is late by; null when nothing is late. */
  oldestOverdueDays: number | null
  /** Finished in the last seven local days, today included. */
  doneThisWeek: number
  /** Finished in the seven days before those. */
  doneLastWeek: number
}

export function overviewMetrics(tasks: SharedTask[], now: Date): Overview {
  const open = tasks.filter(isOpen)
  const late = open.filter((task) => isOverdue(task.dueDate, task.status, now))
  const dueToday = open.filter((task) => task.dueDate && dueDay(task.dueDate, now) === 'today')
  const inProgress = open.filter((task) => task.status === 'in_progress')
  const finishedDaysAgo = tasks.flatMap((task) =>
    task.completedAt ? [daysAgo(task.completedAt, now)] : [],
  )

  return {
    open: open.length,
    overdue: late.length,
    dueToday: dueToday.length,
    dueTodayStarted: dueToday.filter((task) => task.status === 'in_progress').length,
    inProgress: inProgress.length,
    inProgressPlaces: new Set(inProgress.map((task) => task.locationId)).size,
    oldestOverdueDays:
      late.length === 0
        ? null
        : Math.max(...late.map((task) => daysAgo(task.dueDate as string, now))),
    doneThisWeek: finishedDaysAgo.filter((days) => days >= 0 && days <= 6).length,
    doneLastWeek: finishedDaysAgo.filter((days) => days >= 7 && days <= 13).length,
  }
}

// --- Team activity ---

export interface ActivityDay {
  /** The day's local midnight. */
  date: Date
  created: number
  completed: number
}

// Tasks created and tasks finished on each of the last `days` local days, oldest first and
// ending on today, with every empty day present as a zero: a chart that skipped the quiet days
// would draw a busy week out of a slow one. Read from each task's own createdAt and completedAt,
// so the line is the board's real history (the round-11 week card had to invent six of its days).
export function activitySeries(tasks: SharedTask[], now: Date, days: number): ActivityDay[] {
  const series = Array.from({ length: days }, (_, index) => ({
    date: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index)),
    created: 0,
    completed: 0,
  }))
  const slot = (iso: string) => {
    const ago = daysAgo(iso, now)
    return ago >= 0 && ago < days ? series[days - 1 - ago] : undefined
  }
  for (const task of tasks) {
    const created = slot(task.createdAt)
    if (created) created.created += 1
    const completed = task.completedAt ? slot(task.completedAt) : undefined
    if (completed) completed.completed += 1
  }
  return series
}

// --- Team workload ---

export interface PersonWorkload {
  userId: string
  name: string
  avatarTone: number | null
  /** Open and past its due date. */
  overdue: number
  /** Open, not started, not late. */
  todo: number
  /** Open, started, not late. */
  inProgress: number
  open: number
}

// Each person's open work as one stacked bar. The three parts are a partition: a late task is
// counted once, as late, whatever its status, so the bar's length is always the person's real
// open count. A task with several people counts once on each of them, since the point is each
// person's own plate; finished work and unassigned work appear nowhere here.
//
// Late work first, because a late task is the one thing on this card that asks for something;
// then the heaviest load, which is who needs a hand.
export function workload(tasks: SharedTask[], now: Date): PersonWorkload[] {
  const rows = new Map<string, PersonWorkload>()
  for (const task of tasks) {
    if (!isOpen(task)) continue
    const late = isOverdue(task.dueDate, task.status, now)
    for (const person of task.assignees) {
      const row = rows.get(person.id) ?? {
        userId: person.id,
        name: person.displayName,
        avatarTone: person.avatarTone,
        overdue: 0,
        todo: 0,
        inProgress: 0,
        open: 0,
      }
      if (late) row.overdue += 1
      else if (task.status === 'in_progress') row.inProgress += 1
      else row.todo += 1
      row.open += 1
      rows.set(person.id, row)
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name),
  )
}

// --- Across the chain ---

export interface PlaceRow {
  id: string
  name: string
  open: number
  overdue: number
}

const byTrouble = (a: PlaceRow, b: PlaceRow) =>
  b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name)

function tallyOpen(
  tasks: SharedTask[],
  keyOf: (task: SharedTask) => string | undefined,
  now: Date,
) {
  const tally = new Map<string, { open: number; overdue: number }>()
  for (const task of tasks) {
    if (!isOpen(task)) continue
    const key = keyOf(task)
    if (key === undefined) continue
    const row = tally.get(key) ?? { open: 0, overdue: 0 }
    row.open += 1
    if (isOverdue(task.dueDate, task.status, now)) row.overdue += 1
    tally.set(key, row)
  }
  return tally
}

// Open and late work per place, the place in trouble first. A place whose name the viewer has
// not been given is left out rather than shown as a raw id, and a place with nothing open is not
// a row: the list is where to go, not a register of every branch.
export function placeRows(tasks: SharedTask[], names: Map<string, string>, now: Date): PlaceRow[] {
  return [...tallyOpen(tasks, (task) => task.locationId, now)]
    .flatMap(([id, counts]) => {
      const name = names.get(id)
      return name ? [{ id, name, ...counts }] : []
    })
    .sort(byTrouble)
}

export interface BranchHealth {
  /** Branches holding at least one late task. */
  behind: number
  /** Branches with open work, none of it late. */
  onTrack: number
  /** Branches with nothing open, a branch with no tasks at all included. */
  clear: number
}

// Every branch read three ways. It counts over the branch list it is handed, not over the tasks:
// a branch with nothing on the board is clear, and it has to be counted as clear, or the ring
// would describe only the branches that happen to have work.
export function branchHealth(tasks: SharedTask[], branchIds: string[], now: Date): BranchHealth {
  const tally = tallyOpen(tasks, (task) => task.locationId, now)
  const health = { behind: 0, onTrack: 0, clear: 0 }
  for (const id of branchIds) {
    const row = tally.get(id)
    if (!row) health.clear += 1
    else if (row.overdue > 0) health.behind += 1
    else health.onTrack += 1
  }
  return health
}

// Open and late work per department. A task carries no department of its own: it is its
// subject's, so the screen hands in the subject-to-department map it read. Work filed under a
// subject the viewer cannot resolve is left out rather than guessed at.
export function departmentRows(
  tasks: SharedTask[],
  subjectDepartment: Map<string, string>,
  departments: { id: string; name: string }[],
  now: Date,
): PlaceRow[] {
  const tally = tallyOpen(
    tasks,
    (task) => (task.subjectId ? subjectDepartment.get(task.subjectId) : undefined),
    now,
  )
  return departments
    .flatMap((department) => {
      const counts = tally.get(department.id)
      return counts ? [{ id: department.id, name: department.name, ...counts }] : []
    })
    .sort(byTrouble)
}

// High first: the ring and its legend both read top-down as "what is worth the most", and a
// reader looking for the urgent slice should not have to hunt past the default tier to find it.
const PRIORITY_ORDER = ['high', 'medium', 'normal'] as const satisfies TaskPriority[]
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, normal: 2 }

export interface PriorityMix {
  priority: TaskPriority
  count: number
}

// The priority split of what is LEFT, never of the whole board. Status says where a task IS,
// priority says what it is WORTH, and a board can be 70% done and still be carrying every
// high-priority job it started with. Finished tasks are excluded on the same rule the due-date
// figures follow: the priority of a job already done is history.
export function priorityMix(tasks: Task[]): PriorityMix[] {
  const open = tasks.filter(isOpen)
  return PRIORITY_ORDER.map((priority) => ({
    priority,
    count: open.filter((task) => task.priority === priority).length,
  }))
}

// --- Needs attention ---

export interface Attention {
  /** Open and late, the latest first. */
  overdue: SharedTask[]
  /** Open and due today, the highest priority first. */
  dueToday: SharedTask[]
  /** Open and high priority, the nearest due date first, undated last. */
  high: SharedTask[]
}

const dueTime = (task: Task) =>
  task.dueDate ? new Date(task.dueDate).getTime() : Number.POSITIVE_INFINITY

// The three short lists the card's tabs switch between. Each ends on the board's own manual
// order, so two equally urgent tasks read in the order the branch already keeps them.
export function attention(tasks: SharedTask[], now: Date): Attention {
  const open = tasks.filter(isOpen)
  return {
    overdue: open
      .filter((task) => isOverdue(task.dueDate, task.status, now))
      .sort((a, b) => dueTime(a) - dueTime(b) || a.position - b.position),
    dueToday: open
      .filter((task) => task.dueDate && dueDay(task.dueDate, now) === 'today')
      .sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.position - b.position,
      ),
    high: open
      .filter((task) => task.priority === 'high')
      .sort((a, b) => dueTime(a) - dueTime(b) || a.position - b.position),
  }
}
