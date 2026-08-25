import type { Role, Task } from '@burgers/shared'

// The board's per-viewer lenses (v2, 2026-08-20), kept apart from the screen so each one is
// unit-reasonable without a DOM — the same split board-columns.ts makes for the kanban.
//
// Every lens here is a VIEW, never a write: none of them touches status, the shared manual
// order, or anything on the wire. That is why they compose freely and why an active lens
// disables drag on the screen (a per-viewer narrowing is not the order a manager writes).

// Which of the two boards is showing. They are different sets of rows, not two views of one:
// `personal` is this account's private work, which nobody else can read (2026-08-25), and `all`
// is the shared board their role reaches. The API returns both on one read and marks each row,
// so this lens is the split rather than a narrowing.
export type TaskScope = 'personal' | 'all'

// How the same tasks are laid out. The board is the shipped kanban; the list is the dense
// table for someone scanning a long board rather than working one.
export type TaskView = 'board' | 'list'

// The sentinel a "no filter chosen" select carries. A real branch or person id is a uuid, so
// this can never collide with one.
export const ANY_FILTER = 'all'

export interface TaskLenses {
  scope: TaskScope
  // A branch id, or ANY_FILTER. Only an admin ever sees a board that mixes branches.
  branchId: string
  // An assignee's user id, ANY_FILTER, or BACKLOG_FILTER for the unassigned pile.
  assigneeId: string
  // A role, or ANY_FILTER (owner ask 2026-08-21). A task has no role of its own — it is the
  // PEOPLE on it who hold one — so this lens keeps a task when anyone assigned to it holds the
  // chosen role. "Show me what the managers are carrying" is the question it answers.
  role: Role | typeof ANY_FILTER
  // The ids of everyone holding `role`, resolved by the screen from the people list it already
  // loads for the assignee picker. Undefined while that list is still in flight, which reads as
  // "nobody matches yet" rather than as "everybody does".
  roleMemberIds?: Set<string>
  // The case-insensitive title search, already trimmed and lowercased by the caller.
  term: string
}

// Unassigned is a real thing to filter by, not the absence of a filter: the backlog is the
// pile a manager hands out at the start of a shift, so it earns its own option.
export const BACKLOG_FILTER = 'backlog'

// Apply every active lens in one pass. Order is irrelevant (they are all conjunctive), and an
// unset lens costs one comparison, so the common case — nothing chosen — is a cheap identity.
export function applyLenses(tasks: Task[], lenses: TaskLenses): Task[] {
  const { scope, branchId, assigneeId, role, roleMemberIds, term } = lenses
  return tasks.filter((task) => {
    // The two boards never mix: private work stays off the shared board even for the one person
    // who can see it, or their own notes would sit in the middle of the branch's shift.
    if (task.personal !== (scope === 'personal')) return false
    if (branchId !== ANY_FILTER && task.locationId !== branchId) return false
    if (role !== ANY_FILTER) {
      const members = roleMemberIds
      if (!members || !task.assignees.some((assignee) => members.has(assignee.id))) return false
    }
    if (assigneeId === BACKLOG_FILTER) {
      if (task.assignees.length > 0) return false
    } else if (assigneeId !== ANY_FILTER && !isAssignedTo(task, assigneeId)) return false
    if (term !== '' && !task.title.toLowerCase().includes(term)) return false
    return true
  })
}

function isAssignedTo(task: Task, userId: string | undefined): boolean {
  return userId !== undefined && task.assignees.some((assignee) => assignee.id === userId)
}

// The branch's work, without the viewer's own private rows. One board read serves the Tasks
// screen, the dashboard and the branch pages alike, and it carries both kinds of row; anything
// that reports on the BRANCH — a count, a chart, an overdue tally — has to drop the private ones
// first, or the viewer's own notes would quietly inflate numbers nobody else can reconcile
// (owner call 2026-08-25).
// Narrowed on the way out: a task on the shared board always names a branch (the API's own
// tasks_location_or_personal_check), so everything downstream can group and count by it without
// a null check that could never fire.
export type SharedTask = Task & { locationId: string }

export function sharedTasks(tasks: Task[]): SharedTask[] {
  return tasks.filter((task): task is SharedTask => !task.personal && task.locationId !== null)
}

// Whether any lens is narrowing the board. The screen reads this to decide two things: whether
// to offer drag (a narrowed view is not the shared order) and whether an empty result means
// "no tasks" or "no matches".
export function hasActiveLens(lenses: TaskLenses): boolean {
  return (
    lenses.scope === 'personal' ||
    lenses.branchId !== ANY_FILTER ||
    lenses.assigneeId !== ANY_FILTER ||
    lenses.role !== ANY_FILTER ||
    lenses.term !== ''
  )
}
