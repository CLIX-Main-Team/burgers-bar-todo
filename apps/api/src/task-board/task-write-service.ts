import type { TaskPriority, TaskStatus } from '@burgers/shared'
import type { Principal } from '../auth/principal.js'
import type { TaskBoardEvents } from './events.js'
import type { TaskBoardRepository, TaskRow } from './repository.js'

// The task-board write service (#133, Slice B; ADR-0007, ADR-0015). It owns the three manager/admin
// writes — create, full-update (edit + reassign), and delete — and the two rules the umbrella pins
// on every write: the tier-two scope predicate (a manager acts only on their own location, an admin
// chain-wide), applied through the repository's scoped write methods, and the assignee-location
// invariant (every assignee belongs to the task's own location), checked here before any write.
// The tier-one role guard lives at the route, so an employee never reaches this service at all.
//
// Every successful write announces the changed task on the in-process bus (#132) so the SSE fan-out
// relays it to in-scope subscribers. The service never reimplements the scope rule for that relay —
// it publishes only a task id, and the fan-out re-reads the task through the very predicate that
// gates reads (ADR-0015), so the live path and the write path cannot diverge.

// What the create command carries once the route has parsed the request (ISO strings → Dates). The
// location is the client's ask; the service resolves the real target from the principal below and
// never trusts this blindly (ADR-0007). assigneeIds may be empty — that is the backlog.
export interface CreateTaskCommand {
  title: string
  description: string | null
  priority: TaskPriority
  dueDate: Date | null
  assigneeIds: string[]
  // The board the client asked to add to: null/omitted for a manager (their own is used), a real
  // location for an admin (who holds none of their own).
  locationId: string | null
}

// What the full-update command carries: the editable fields in one replace. No location (a task
// never moves location in v1). status is optional (#134, story 43): a manager/admin may also move it
// through the full edit, and when it is omitted the status is left exactly as it stands.
export interface UpdateTaskCommand {
  title: string
  description: string | null
  priority: TaskPriority
  dueDate: Date | null
  assigneeIds: string[]
  status?: TaskStatus
}

// Create refuses in two distinguishable ways the route maps to 403 and 400: `forbidden` when the
// principal may not create on the resolved board (a manager reaching past their own location), and
// `invalid` when the request is malformed for the principal's own remit (an admin naming no
// location) or names a cross-location assignee (the assignee-location invariant).
export type CreateTaskResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'forbidden' | 'invalid' }

// Edit answers `not_found` for any task outside the principal's write scope (unknown, or another
// location's — one non-enumerating 404), or `invalid` for a cross-location assignee (400).
export type UpdateTaskResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'not_found' | 'invalid' }

// A status change answers `not_found` for any task outside the caller's scope — a non-assigned task
// for an employee, another location's for a manager, or an unknown id — the same one non-enumerating
// 404 the by-id edits use, so acting on an id never confirms a task the caller may not see.
export type UpdateTaskStatusResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'not_found' }

// Delete answers `ok`, or `not_found` for any task outside the principal's write scope — the same
// non-enumerating 404 as edit, so acting on an id never confirms a row on another location's board.
export type DeleteTaskOutcome = 'ok' | 'not_found'

// What the reorder command carries once the route has parsed the request (#135, Slice D): the ordered
// ids of a single location's tasks, plus the board the client asked to arrange — null/omitted for a
// manager (their own is used), a real location for an admin (who holds none of their own). The service
// resolves the real target from the principal and never trusts this blindly (ADR-0007).
export interface ReorderTasksCommand {
  orderedIds: string[]
  locationId: string | null
}

// Reorder refuses the same two distinguishable ways create does, mapped to 403 and 400: `forbidden`
// when the principal may not write the resolved board (a manager naming another location), and
// `invalid` when the request is malformed for their own remit (an admin naming none) or names a task
// outside the target location (the tasks-in-location invariant). Success carries the reordered board.
export type ReorderTasksResult =
  | { ok: true; tasks: TaskRow[] }
  | { ok: false; reason: 'forbidden' | 'invalid' }

export interface TaskWriteService {
  createTask(principal: Principal, command: CreateTaskCommand): Promise<CreateTaskResult>
  updateTask(
    principal: Principal,
    taskId: string,
    command: UpdateTaskCommand,
  ): Promise<UpdateTaskResult>
  // The employee status-only write path (#134, Slice C): move a task's status and nothing else. No
  // tier-one role guard gates the route, so this is reached by an employee as well as a manager/admin;
  // authorisation is the scope predicate the repository applies, which admits an employee only for a
  // task assigned to them. Announces the change on the bus like every write so A2 relays it.
  updateTaskStatus(
    principal: Principal,
    taskId: string,
    status: TaskStatus,
  ): Promise<UpdateTaskStatusResult>
  deleteTask(principal: Principal, taskId: string): Promise<DeleteTaskOutcome>
  // Set a location's shared manual order (#135, Slice D): rewrite `position` from the ordered id list.
  // Manager/admin only (the tier-one role guard at the route bars an employee — story 49); the target
  // board is resolved from the principal (a manager's own, an admin's named one) and every id must
  // belong to it (the tasks-in-location invariant) before any position is written — so a manager
  // cannot arrange another location and no order can smuggle in a foreign task. Announces every
  // reordered task on the bus so A2 relays the new arrangement to in-scope subscribers (story 52).
  reorderTasks(principal: Principal, command: ReorderTasksCommand): Promise<ReorderTasksResult>
}

// Resolve the board a location-naming write acts on from the acting principal (ADR-0007), never
// blindly from the body — the create-time analogue of the scope predicate the by-id writes carry in
// their WHERE. Shared by create (#133) and reorder (#135), the two writes whose target is a whole
// board rather than a task already in scope, so both resolve it the identical way:
//
// - An admin holds no location of their own, so they must name the board; naming none is `invalid`.
// - A manager acts only on their own location. A manager naming any other board is `forbidden`, not
//   silently redirected; an omitted location defaults to their own.
// - No other role reaches here (the route guard admits only admin and manager); fail closed anyway.
function resolveWriteLocation(
  principal: Principal,
  bodyLocationId: string | null,
): { locationId: string } | { reason: 'forbidden' | 'invalid' } {
  if (principal.role === 'admin') {
    if (!bodyLocationId) return { reason: 'invalid' }
    return { locationId: bodyLocationId }
  }
  if (principal.role === 'manager') {
    if (!principal.locationId) return { reason: 'forbidden' }
    if (bodyLocationId != null && bodyLocationId !== principal.locationId) {
      return { reason: 'forbidden' }
    }
    return { locationId: principal.locationId }
  }
  return { reason: 'forbidden' }
}

export function createTaskWriteService(
  repository: TaskBoardRepository,
  events: TaskBoardEvents,
): TaskWriteService {
  return {
    createTask: async (principal, command) => {
      const location = resolveWriteLocation(principal, command.locationId)
      if ('reason' in location) {
        return { ok: false, reason: location.reason }
      }

      // The assignee-location invariant, checked before the write (never smuggled past the assign
      // path): every assignee must belong to the task's own location. A cross-location id — or one
      // naming no user — is refused as invalid, so a task can never land carrying an out-of-location
      // assignee.
      const offending = await repository.assigneesOutsideLocation(
        command.assigneeIds,
        location.locationId,
      )
      if (offending.length > 0) {
        return { ok: false, reason: 'invalid' }
      }

      const task = await repository.createTask({
        locationId: location.locationId,
        // The creator is the acting principal (#258) — resolved here from the session, never a
        // body field, so authorship can no more be forged than the location can.
        createdBy: principal.userId,
        title: command.title,
        description: command.description,
        priority: command.priority,
        dueDate: command.dueDate,
        assigneeIds: command.assigneeIds,
      })
      events.publish({ taskId: task.id })
      return { ok: true, task }
    },

    updateTask: async (principal, taskId, command) => {
      // Read the task through the principal's scope first: it both enforces "you may edit this" (a
      // task outside scope reads as absent) and yields the task's own location — the location the
      // assignee-location invariant is checked against, since an edit never moves a task.
      const existing = await repository.getScopedTask(principal, taskId)
      if (!existing) {
        return { ok: false, reason: 'not_found' }
      }

      const offending = await repository.assigneesOutsideLocation(
        command.assigneeIds,
        existing.locationId,
      )
      if (offending.length > 0) {
        return { ok: false, reason: 'invalid' }
      }

      const task = await repository.updateTaskInScope(principal, taskId, command)
      // Gone between the scoped read and the scoped write (a concurrent delete): a plain not-found,
      // not a crash. The write carries the scope predicate too, so this is never a scope bypass.
      if (!task) {
        return { ok: false, reason: 'not_found' }
      }
      events.publish({ taskId: task.id })
      return { ok: true, task }
    },

    updateTaskStatus: async (principal, taskId, status) => {
      // The scoped status-only write is the whole of it: the repository writes status only where the
      // scope predicate admits the row, so an out-of-scope task (a non-assigned one for an employee,
      // another location's for a manager) returns null — a non-enumerating 404, never a leak. No
      // assignee-location invariant to re-check (status touches no membership) and no field
      // allow-list to police (the query writes one column).
      const task = await repository.updateTaskStatusInScope(principal, taskId, status)
      if (!task) {
        return { ok: false, reason: 'not_found' }
      }
      // Announce it like every write so the SSE fan-out relays the changed task to in-scope
      // subscribers (a manager sees an employee's progress without asking — story 45).
      events.publish({ taskId: task.id })
      return { ok: true, task }
    },

    deleteTask: async (principal, taskId) => {
      const removed = await repository.deleteTaskInScope(principal, taskId)
      if (!removed) {
        return 'not_found'
      }
      // Announce the write like every other (the umbrella's "every write emits the events"). The
      // upsert-only fan-out re-reads the now-deleted task, gets null, and withholds it, so a delete
      // produces no live frame — a deleted task leaves other boards on their next read, by design
      // (ADR-0015 relays task upserts, not removals).
      events.publish({ taskId })
      return 'ok'
    },

    reorderTasks: async (principal, command) => {
      // Resolve the board this reorder arranges the same way create does: a manager's own location,
      // an admin's named one, and a manager naming another board is forbidden (never redirected).
      const location = resolveWriteLocation(principal, command.locationId)
      if ('reason' in location) {
        return { ok: false, reason: location.reason }
      }

      // A well-formed order names each task at most once — `position` is set from the id's index, so
      // a repeated id would place the same task twice and leave a contiguous order impossible. The
      // drag surface can never emit a duplicate, but this is the seam that owns the shared order, so
      // it refuses a malformed one outright rather than writing a corrupt arrangement.
      if (new Set(command.orderedIds).size !== command.orderedIds.length) {
        return { ok: false, reason: 'invalid' }
      }

      // The tasks-in-location invariant, checked before any write (the reorder twin of the
      // assignee-location one): every id must name a task on the resolved board. A foreign or unknown
      // id makes the whole reorder invalid, so an order can never reindex — or even name — a task on
      // another location's board.
      const offending = await repository.tasksOutsideLocation(
        command.orderedIds,
        location.locationId,
      )
      if (offending.length > 0) {
        return { ok: false, reason: 'invalid' }
      }

      const tasks = await repository.reorderTasks(location.locationId, command.orderedIds)
      // Announce every task the reorder placed so the SSE fan-out relays the new arrangement: each
      // in-scope subscriber re-reads and re-sorts by position, so the board updates on everyone at
      // once (story 52). A subscriber outside scope re-reads null and the change is withheld — the
      // same boundary every relay draws, so a reorder never leaks a task that was never theirs.
      for (const id of command.orderedIds) {
        events.publish({ taskId: id })
      }
      return { ok: true, tasks }
    },
  }
}
