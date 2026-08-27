import { type TaskPriority, type TaskStatus, hasAdminAuthority, holdsBranch } from '@burgers/shared'
import type { Principal } from '../auth/principal.js'
import type { TaskNotifier } from '../notifications/task-notifier.js'
import type { TaskBoardEvents } from './events.js'
import type { ChecklistDraftInput, TaskBoardRepository, TaskRow } from './repository.js'

// The task-board write service (#133, Slice B; ADR-0007, ADR-0015). It owns the three manager/admin
// writes — create, full-update (edit + reassign), and delete — and the two rules the umbrella pins
// on every write: the tier-two scope predicate (a branch admin acts only on their own location,
// exactly like a manager; only a super_admin is chain-wide), applied through the repository's
// scoped write methods, and the assignee-location
// invariant (every assignee belongs to the task's own location), checked here before any write.
// The tier-one guard lives at the route (a capability since 2026-08-24, not a fixed role), so a
// caller without tasks.manage reaches only the status path — and create's `personal` mode, whose
// narrower law the service enforces itself below.
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
  // The board the client asked to add to: null/omitted for a manager or branch admin (their own
  // is used), a real location for a super_admin (who holds none of their own).
  locationId: string | null
  // File the task into a project as it is created — how the project screen's own "New task" row
  // works. Null is loose board work. A project the principal may not see is refused rather than
  // silently ignored, so naming somebody else's project can never move work into it.
  projectId: string | null
  // The private path (owner ask 2026-08-24, widened to every role 2026-08-25): a task for the
  // caller alone, which nobody else can read. The route takes this from the body — a manager holds
  // both paths and says which one they meant — and checks tasks.createPersonal before handing it
  // over; the service then enforces the whole shape, no branch, self as the only assignee, no
  // project filing, rather than trusting the route to have narrowed the body. False is the shared
  // board exactly as it was.
  personal: boolean
  // The checklist typed while the task was described (2026-08-26), in the order it was typed, each
  // step with the people who own it.
  checklist: ChecklistDraftInput[]
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
  // Undefined leaves the checklist untouched; an array replaces it wholesale, reconciled by id so
  // an edit that renames one line never unticks the rest.
  checklist?: ChecklistDraftInput[]
  status?: TaskStatus
  // Undefined leaves the filing alone; an explicit null unfiles the task back to the loose board.
  projectId?: string | null
}

// Create refuses in two distinguishable ways the route maps to 403 and 400: `forbidden` when the
// principal may not create on the resolved board (a manager or branch admin reaching past their own
// location), and `invalid` when the request is malformed for the principal's own remit (a
// super_admin naming no location) or names a cross-location assignee (the assignee-location
// invariant).
export type CreateTaskResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'forbidden' | 'invalid' }

// Edit answers `not_found` for any task outside the principal's write scope (unknown, another
// location's, or shared work a manager did not write — one non-enumerating 404), `invalid` for a
// cross-location assignee or an edit that would take a private task public (400), and `forbidden`
// for an assignee above the caller's ladder (403) — that last one names a real person the caller
// can see and pick, so saying no plainly beats pretending the task vanished.
export type UpdateTaskResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'not_found' | 'invalid' | 'forbidden' }

// A status change answers `not_found` for any task outside the caller's scope — a non-assigned task
// for an employee, another location's for a manager, or an unknown id — the same one non-enumerating
// 404 the by-id edits use, so acting on an id never confirms a task the caller may not see.
export type UpdateTaskStatusResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'not_found' }

// Shaping a checklist can fail three ways, and they are not the same answer: the task is not the
// caller's to reach (not_found, non-enumerating), an owner is outside the task's branch or names no
// user (invalid), or an owner sits above the caller on the ladder (forbidden). Ticking, by
// contrast, has only the first — which is why it keeps the narrower result type above.
export type SetChecklistResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: 'not_found' | 'invalid' | 'forbidden' }

// Delete answers `ok`, or `not_found` for any task outside the principal's write scope — the same
// non-enumerating 404 as edit, so acting on an id never confirms a row on another location's board.
export type DeleteTaskOutcome = 'ok' | 'not_found'

// How far a by-id write may reach, resolved from the caller's capabilities at the route and
// handed down rather than looked up here — tier one stays at the route, tier two stays in the
// service (ADR-0007).
//
//   'board'    the caller holds tasks.manage: the scope predicate and the ownership rule below
//              are the only limits.
//   'personal' the caller holds only tasks.createPersonal: their own private work, and nothing
//              else. The owner's call of 2026-08-25 — "if its on personal task we must have full
//              control over it" — is what this exists for: a private list you could write into
//              but never correct afterwards is not yours.
export type WriteReach = 'board' | 'personal'

// What the reorder command carries once the route has parsed the request (#135, Slice D): the ordered
// ids of a single location's tasks, plus the board the client asked to arrange — null/omitted for a
// manager or branch admin (their own is used), a real location for a super_admin (who holds none of
// their own). The service resolves the real target from the principal and never trusts this blindly
// (ADR-0007).
export interface ReorderTasksCommand {
  orderedIds: string[]
  locationId: string | null
}

// Reorder refuses the same two distinguishable ways create does, mapped to 403 and 400: `forbidden`
// when the principal may not write the resolved board (a manager or branch admin naming another
// location), and `invalid` when the request is malformed for their own remit (a super_admin naming
// none) or names a task outside the target location (the tasks-in-location invariant). Success
// carries the reordered board.
export type ReorderTasksResult =
  | { ok: true; tasks: TaskRow[] }
  | { ok: false; reason: 'forbidden' | 'invalid' }

export interface TaskWriteService {
  createTask(principal: Principal, command: CreateTaskCommand): Promise<CreateTaskResult>
  updateTask(
    principal: Principal,
    taskId: string,
    command: UpdateTaskCommand,
    reach: WriteReach,
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
  // Tick or untick one checklist item (2026-08-26). Scoped exactly like the status write and gated
  // the same way — no tier-one role guard at the route, the scope predicate IS the authorisation —
  // because ticking a step is what the person doing the work does, not what its author does.
  toggleChecklistItem(
    principal: Principal,
    taskId: string,
    itemId: string,
    done: boolean,
  ): Promise<UpdateTaskStatusResult>
  // Replace a task's whole checklist (2026-08-26). Gated at the route by the same tier-one guard the
  // full edit carries — shaping a list is authoring — and scoped in the repository by the same
  // predicate, so a task outside the caller's write scope is one non-enumerating not-found.
  setChecklist(
    principal: Principal,
    taskId: string,
    drafts: ChecklistDraftInput[],
  ): Promise<SetChecklistResult>
  deleteTask(principal: Principal, taskId: string, reach: WriteReach): Promise<DeleteTaskOutcome>
  // Set a location's shared manual order (#135, Slice D): rewrite `position` from the ordered id list.
  // Manager/admin only (the tier-one role guard at the route bars an employee — story 49); the target
  // board is resolved from the principal (a manager or branch admin's own, a super_admin's named
  // one) and every id must belong to it (the tasks-in-location invariant) before any position is
  // written — so a manager or branch admin cannot arrange another location and no order can smuggle
  // in a foreign task. Announces every reordered task on the bus so A2 relays the new arrangement to
  // in-scope subscribers (story 52).
  reorderTasks(principal: Principal, command: ReorderTasksCommand): Promise<ReorderTasksResult>
}

// Resolve the board a location-naming write acts on from the acting principal (ADR-0007), never
// blindly from the body — the create-time analogue of the scope predicate the by-id writes carry in
// their WHERE. Shared by create (#133) and reorder (#135), the two writes whose target is a whole
// board rather than a task already in scope, so both resolve it the identical way:
//
// - A branch-less principal (super_admin, and since 2026-08-27 any HQ role holding
//   tasks.manage) has no location of their own, so they must name the board; naming none is
//   `invalid`.
// - A branch admin and a manager act only on their own location, exactly alike (2026-08-23): a
//   branch admin now carries a real location the same way a manager does. Naming any other board
//   is `forbidden`, not silently redirected; an omitted location defaults to their own.
// - No other role reaches here (the route guard admits only the admin roles and manager); fail
//   closed anyway.
function resolveWriteLocation(
  principal: Principal,
  bodyLocationId: string | null,
): { locationId: string } | { reason: 'forbidden' | 'invalid' } {
  if (!holdsBranch(principal.role)) {
    if (!bodyLocationId) return { reason: 'invalid' }
    return { locationId: bodyLocationId }
  }
  // Any branch-holding role, not a role list (2026-08-24): the tier-one guard is a
  // capability the owner may widen, and a widened role must land in the branch lane here
  // rather than the fail-closed floor. A branch admin and a manager both carry a real
  // location (2026-08-23), so this is identical behavior under the default switches.
  if (principal.locationId) {
    if (bodyLocationId != null && bodyLocationId !== principal.locationId) {
      return { reason: 'forbidden' }
    }
    return { locationId: principal.locationId }
  }
  return { reason: 'forbidden' }
}

// Who this write newly put on the task, and therefore who deserves a push (#59). Two rules make
// the answer honest:
//
//   - Only people who were not already on it. The edit path replaces the whole assignee set on
//     every save, so "the command's assignees" would re-notify the same people on an unrelated
//     due-date change; the pre-image is read before the write anyway (for the scope check), so the
//     genuine difference costs nothing to compute.
//   - Never the actor. A manager who puts themselves on a task does not need their own phone to
//     tell them about it.
function newlyAssigned(
  principal: Principal,
  assigneeIds: readonly string[],
  alreadyAssigned: readonly string[] = [],
): string[] {
  const before = new Set(alreadyAssigned)
  return [...new Set(assigneeIds)].filter((id) => id !== principal.userId && !before.has(id))
}

export function createTaskWriteService(
  repository: TaskBoardRepository,
  events: TaskBoardEvents,
  notifier: TaskNotifier,
): TaskWriteService {
  // Who this principal may hand work to (owner call 2026-08-25). An admin role tasks anyone on the
  // board it runs; everybody else below them tasks their own level and down — which is what makes a
  // manager a manager rather than a second admin: they run the shift, they do not task the person
  // who runs the branch. Asked of the ROLE, not of a capability: tasks.manage is a yes/no the owner
  // may widen, and how far a yes reaches has stayed role-derived since the switches landed.
  async function assigneesOutsideLadder(
    principal: Principal,
    assigneeIds: readonly string[],
  ): Promise<boolean> {
    if (hasAdminAuthority(principal.role)) return false
    const offending = await repository.assigneesOutsideRoles(
      [...assigneeIds],
      ['manager', 'employee'],
    )
    return offending.length > 0
  }

  // A checklist's step owners obey exactly the two rules the task's own assignee set obeys: every
  // one of them belongs to the task's branch, and none of them sits above the caller on the ladder.
  // They have to, because owning a step PUTS you on the task (repository.writeChecklist) — so a
  // laxer rule here would be a way to assign somebody to a task through the back door.
  //
  // A private task has no branch, and nobody but its writer can read it, so a step on one takes no
  // owners at all rather than an unchecked set.
  async function checklistOwnersRefused(
    principal: Principal,
    locationId: string | null,
    drafts: readonly { assigneeIds: string[] }[],
  ): Promise<'invalid' | 'forbidden' | null> {
    const owners = [...new Set(drafts.flatMap((draft) => draft.assigneeIds))]
    if (owners.length === 0) return null
    if (!locationId) return 'invalid'
    const offending = await repository.assigneesOutsideLocation(owners, locationId)
    if (offending.length > 0) return 'invalid'
    if (await assigneesOutsideLadder(principal, owners)) return 'forbidden'
    return null
  }

  // Whose work this principal may edit or delete once the scope predicate has already let them
  // see it.
  //
  // A private task is always its writer's own, whatever role they hold and whatever else they may
  // reach: the scope predicate has already established that nobody else can even read it, so
  // there is no one left to protect it from. That is the whole of "full control over it".
  //
  // Shared work is the branch's: an admin role owns its whole board, and a manager owns the work
  // they wrote — they may task the shift and take it back, but the branch admin's instructions
  // are not theirs to rewrite. A caller who reaches only their private list never gets here.
  function mayWrite(principal: Principal, task: TaskRow, reach: WriteReach): boolean {
    if (task.personal) return true
    if (reach === 'personal') return false
    return hasAdminAuthority(principal.role) || task.createdBy === principal.userId
  }

  return {
    createTask: async (principal, command) => {
      // The personal path holds its own, narrower law: the task belongs to the caller and to no
      // branch at all (2026-08-25 — private work is a property of the person, and the chain's
      // owner holds no branch to file it under), names the caller as its one assignee, and files
      // into no project. Each violation is refused, never repaired — silently rewriting the body
      // would look like success and hide what was asked for.
      const location = command.personal
        ? { locationId: null }
        : resolveWriteLocation(principal, command.locationId)
      if ('reason' in location) {
        return { ok: false, reason: location.reason }
      }
      if (command.personal) {
        const selfOnly =
          command.assigneeIds.length === 1 && command.assigneeIds[0] === principal.userId
        if (!selfOnly || command.projectId) {
          return { ok: false, reason: 'invalid' }
        }
      }

      // The assignee-location invariant, checked before the write (never smuggled past the assign
      // path): every assignee must belong to the task's own location. A cross-location id — or one
      // naming no user — is refused as invalid, so a task can never land carrying an out-of-location
      // assignee. A private task has no location to be outside of, and its one assignee has already
      // been checked to be the caller, so the invariant has nothing left to say about it.
      if (location.locationId) {
        const offending = await repository.assigneesOutsideLocation(
          command.assigneeIds,
          location.locationId,
        )
        if (offending.length > 0) {
          return { ok: false, reason: 'invalid' }
        }
      }

      const outsideLadder = await assigneesOutsideLadder(principal, command.assigneeIds)
      if (outsideLadder) {
        return { ok: false, reason: 'forbidden' }
      }

      const ownersRefused = await checklistOwnersRefused(
        principal,
        location.locationId,
        command.checklist ?? [],
      )
      if (ownersRefused) {
        return { ok: false, reason: ownersRefused }
      }

      // Filing into a project is a project write as much as a task one, so it goes through the
      // projects scope predicate. Refused rather than dropped: silently creating an unfiled task
      // would look like success and lose the filing the caller asked for.
      if (command.projectId && !(await repository.projectInScope(principal, command.projectId))) {
        return { ok: false, reason: 'invalid' }
      }

      const task = await repository.createTask({
        locationId: location.locationId,
        personal: command.personal,
        // The creator is the acting principal (#258) — resolved here from the session, never a
        // body field, so authorship can no more be forged than the location can.
        createdBy: principal.userId,
        title: command.title,
        description: command.description,
        priority: command.priority,
        dueDate: command.dueDate,
        assigneeIds: command.assigneeIds,
        projectId: command.projectId,
        checklist: command.checklist,
      })
      events.publish({ taskId: task.id })
      // Ring the phones of everyone this task just landed on (#59). Awaited rather than left to
      // run loose: the notifier never rejects (a phone that cannot be reached is not a failed
      // write), and awaiting means the notification is on its way before the response is, instead
      // of racing a process recycle. Every assignee on a create is a new one.
      await notifier.taskAssigned({
        taskId: task.id,
        title: task.title,
        userIds: newlyAssigned(principal, command.assigneeIds),
      })
      return { ok: true, task }
    },

    updateTask: async (principal, taskId, command, reach) => {
      // Read the task through the principal's scope first: it both enforces "you may edit this" (a
      // task outside scope reads as absent) and yields the task's own location — the location the
      // assignee-location invariant is checked against, since an edit never moves a task.
      const existing = await repository.getScopedTask(principal, taskId)
      if (!existing) {
        return { ok: false, reason: 'not_found' }
      }
      // Somebody else's shared work, seen but not theirs to rewrite (2026-08-25). Reported as
      // not_found rather than forbidden, the way every other out-of-remit task on this path is:
      // the caller can see the card on their board, so a 403 would be the more confusing answer,
      // and the two must not be distinguishable by probing.
      if (!mayWrite(principal, existing, reach)) {
        return { ok: false, reason: 'not_found' }
      }
      // A private task stays private and stays its writer's own: the assignee set cannot grow past
      // them, and it can never be filed into a project other people read.
      if (existing.personal) {
        const selfOnly =
          command.assigneeIds.length === 1 && command.assigneeIds[0] === principal.userId
        if (!selfOnly || command.projectId) {
          return { ok: false, reason: 'invalid' }
        }
      }

      if (existing.locationId) {
        const offending = await repository.assigneesOutsideLocation(
          command.assigneeIds,
          existing.locationId,
        )
        if (offending.length > 0) {
          return { ok: false, reason: 'invalid' }
        }
      }

      if (await assigneesOutsideLadder(principal, command.assigneeIds)) {
        return { ok: false, reason: 'forbidden' }
      }

      if (command.projectId && !(await repository.projectInScope(principal, command.projectId))) {
        return { ok: false, reason: 'invalid' }
      }

      const task = await repository.updateTaskInScope(principal, taskId, command)
      // Gone between the scoped read and the scoped write (a concurrent delete): a plain not-found,
      // not a crash. The write carries the scope predicate too, so this is never a scope bypass.
      if (!task) {
        return { ok: false, reason: 'not_found' }
      }
      events.publish({ taskId: task.id })
      // Only the people this edit *added* are notified — `existing` is the pre-image read above,
      // so a save that leaves the assignee set alone (a retitle, a new due date) rings nobody.
      await notifier.taskAssigned({
        taskId: task.id,
        title: task.title,
        userIds: newlyAssigned(
          principal,
          command.assigneeIds,
          existing.assignees.map((assignee) => assignee.id),
        ),
      })
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

    setChecklist: async (principal, taskId, drafts) => {
      // The owners are checked against the TASK's branch, so the task has to be read before they
      // can be judged. Out of scope here is the same non-enumerating miss the write itself gives.
      const existing = await repository.getScopedTask(principal, taskId)
      if (!existing) {
        return { ok: false, reason: 'not_found' }
      }
      const ownersRefused = await checklistOwnersRefused(principal, existing.locationId, drafts)
      if (ownersRefused) {
        return { ok: false, reason: ownersRefused }
      }
      const task = await repository.setChecklistInScope(principal, taskId, drafts)
      if (!task) {
        return { ok: false, reason: 'not_found' }
      }
      // Announced like every write, so a board watching this task sees its count change.
      events.publish({ taskId: task.id })
      return { ok: true, task }
    },

    toggleChecklistItem: async (principal, taskId, itemId, done) => {
      // The scoped write is the whole of it, exactly as the status path above: an item on a task the
      // caller cannot see matches nothing and comes back as a non-enumerating not-found.
      const task = await repository.toggleChecklistItemInScope(principal, taskId, itemId, done)
      if (!task) {
        return { ok: false, reason: 'not_found' }
      }
      // Announced like every other write, so a manager watching the board sees the count move while
      // the person doing the work is still inside the task.
      events.publish({ taskId: task.id })
      return { ok: true, task }
    },

    deleteTask: async (principal, taskId, reach) => {
      // The same ownership question the edit asks, and the same silence when the answer is no: a
      // manager may take back the work they assigned, not the work the branch admin did.
      const existing = await repository.getScopedTask(principal, taskId)
      if (!existing || !mayWrite(principal, existing, reach)) {
        return 'not_found'
      }
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
      // Resolve the board this reorder arranges the same way create does: a manager or branch
      // admin's own location, a super_admin's named one, and a manager or branch admin naming
      // another board is forbidden (never redirected).
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
