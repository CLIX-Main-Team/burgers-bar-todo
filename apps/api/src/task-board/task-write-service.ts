import type { TaskPriority } from '@burgers/shared'
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
// never moves location in v1) and no status (Slice C's own path).
export interface UpdateTaskCommand {
  title: string
  description: string | null
  priority: TaskPriority
  dueDate: Date | null
  assigneeIds: string[]
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

// Delete answers `ok`, or `not_found` for any task outside the principal's write scope — the same
// non-enumerating 404 as edit, so acting on an id never confirms a row on another location's board.
export type DeleteTaskOutcome = 'ok' | 'not_found'

export interface TaskWriteService {
  createTask(principal: Principal, command: CreateTaskCommand): Promise<CreateTaskResult>
  updateTask(
    principal: Principal,
    taskId: string,
    command: UpdateTaskCommand,
  ): Promise<UpdateTaskResult>
  deleteTask(principal: Principal, taskId: string): Promise<DeleteTaskOutcome>
}

// Resolve the board a create lands on from the acting principal (ADR-0007), never blindly from the
// body — the create-time analogue of the scope predicate the by-id writes carry in their WHERE:
//
// - An admin holds no location of their own, so they must name the board; naming none is `invalid`.
// - A manager acts only on their own location. A manager naming any other board is `forbidden`, not
//   silently redirected; an omitted location defaults to their own.
// - No other role reaches here (the route guard admits only admin and manager); fail closed anyway.
function resolveCreateLocation(
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
      const location = resolveCreateLocation(principal, command.locationId)
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
  }
}
