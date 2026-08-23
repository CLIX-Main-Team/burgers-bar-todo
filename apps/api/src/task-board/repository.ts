import type { TaskPriority, TaskStatus } from '@burgers/shared'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import { projects, taskAssignees, taskBoardLastSeen, tasks, users } from '../db/schema.js'
import { projectScopePredicate } from '../projects/scope.js'
import { taskScopePredicate } from './scope.js'

// A query executor that is either the pool-bound db or a transaction handle. The write methods run
// their task-row and assignee-set changes inside one transaction and hydrate the result on that same
// handle, so the shared assignee hydration reads the just-written rows atomically rather than over a
// second connection that might not yet see them.
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

// A rendered user reference as the board reads it: identity plus the display name it renders.
// This bare pair names the task's creator (#258); an assignee extends it below.
export interface TaskUserRow {
  id: string
  displayName: string
}

// One assignee on a task: the rendered reference plus when they were put on it (#136) — the
// assignee row's created_at, which the edit path's reconciliation deliberately preserves for
// unchanged assignees, so the badge that dates from it never re-notifies on an unrelated edit.
export interface TaskAssigneeRow extends TaskUserRow {
  assignedAt: Date
}

// A task row plus its resolved assignee set and its creator's rendered name (#258). The base
// fields are inferred straight from the `tasks` table so this type never drifts from the schema.
export type TaskRow = typeof tasks.$inferSelect & {
  assignees: TaskAssigneeRow[]
  creator: TaskUserRow
}

// What a create writes (#133, Slice B): the resolved target location and the task's authored fields,
// plus the assignee set (empty = backlog) and the creator (#258) — the acting principal's user id,
// resolved by the service, never a client-supplied value. The location is resolved from the
// principal in the service before this is built, so the repository is handed a concrete location,
// never a principal to interpret. status is not here — a new task always starts `not_started` (the
// column default), and status only ever moves through Slice C's dedicated path.
export interface CreateTaskInput {
  locationId: string
  createdBy: string
  title: string
  description: string | null
  priority: TaskPriority
  dueDate: Date | null
  assigneeIds: string[]
  // The project to file the new task under, or null for loose board work. The service has already
  // checked it is a project this principal may write to.
  projectId: string | null
}

// What the full-update path replaces (#133, Slice B): every editable field of a task in one write —
// title, description, priority, due date, and the whole assignee set (reassignment is just a new
// set). Location is absent (a task never moves location in v1). status is optional (#134, story 43):
// a manager/admin may also move status through the full edit, but when it is omitted the status
// column is left out of the write entirely — so an unrelated edit never resets status, and the
// completed_at trigger, which fires only when status is written, does not run.
export interface UpdateTaskInput {
  title: string
  description: string | null
  priority: TaskPriority
  dueDate: Date | null
  assigneeIds: string[]
  status?: TaskStatus
  // Undefined leaves the task's project alone (the same reason `status` is optional — an edit
  // written before projects existed must not unfile a task by omission); an explicit null takes it
  // out of its project and back to the loose board.
  projectId?: string | null
}

// The task-board data-access seam (ADR-0007 tier two). Every task read goes through
// `listScopedTasks`, which applies the central scope predicate — there is deliberately no
// unscoped "list all tasks" method for a caller to reach. The last-seen pair backs the
// board-view trigger (#131 owns the trigger; #59 the badge).
export interface TaskBoardRepository {
  // Whether this principal may file work into that project — the projects half of ADR-0007,
  // asked here because filing a task into a project is a task write. It reuses the projects
  // scope predicate rather than restating it, so the two can never drift: a project a manager
  // cannot see is a project they cannot put work into, and naming one is refused rather than
  // silently dropped (which would have quietly created an unfiled task instead).
  projectInScope(principal: Principal, projectId: string): Promise<boolean>
  // The scoped board read: tasks the principal may see, in the shared manual order (position,
  // then a stable id tiebreak), each carrying its assignee set. The priority sort is applied
  // client-side over this list, so the order here is always the manual one.
  listScopedTasks(principal: Principal): Promise<TaskRow[]>
  // One task as this principal is allowed to see it, or null when it is outside their scope (or
  // does not exist). This is the single-row twin of listScopedTasks: it applies the *same*
  // taskScopePredicate, so the live SSE fan-out (#132) filters each change through the very rule
  // that gates reads rather than reimplementing it — the security core of ADR-0015. Returning null
  // for out-of-scope is what makes "an event withheld" fall out of the same code path as "a row
  // never listed": a subscriber gets the change only when this method hands back the task.
  getScopedTask(principal: Principal, taskId: string): Promise<TaskRow | null>
  // This user's board last-seen marker, or null if they have never opened the board.
  readLastSeen(userId: string): Promise<Date | null>
  // Advance (or create) this user's board last-seen marker to `at`.
  bumpLastSeen(userId: string, at: Date): Promise<void>
  // Create a task and its assignee set atomically (#133, Slice B), returning the hydrated row the
  // creator sees. The location is already resolved (the service enforced it against the principal),
  // so create carries no scope predicate of its own — a manager cannot reach here for another
  // location because the service never hands one over.
  createTask(input: CreateTaskInput): Promise<TaskRow>
  // Full-update a task within the principal's write scope (#133, Slice B): replace the editable
  // columns and the whole assignee set, but only where the same ADR-0007 scope predicate that gates
  // reads admits the row. Returns the updated hydrated row, or null when no such task is in scope (a
  // manager reaching past their location, or a task already gone) — the by-id twin of a scoped read.
  updateTaskInScope(
    principal: Principal,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<TaskRow | null>
  // Status-only write within the principal's scope (#134, Slice C). Writes the single status column
  // and nothing else — the ADR-0002 "only the status" rule as a query, not a field allow-list — where
  // the same ADR-0007 scope predicate that gates reads admits the row. That predicate *is* the
  // authorisation: an employee reaches it only for a task that names them (their assignee-membership
  // filter), a manager for their location, an admin chain-wide, so a non-assigned or out-of-location
  // task matches nothing and returns null — the by-id twin of a scoped read, one non-enumerating miss.
  // completed_at is not set here: the tasks trigger maintains it on entering/leaving done, and the
  // returned row already reflects it (RETURNING sees the trigger's edit). Returns the hydrated row, or
  // null when no such task is in scope (or it was concurrently deleted).
  updateTaskStatusInScope(
    principal: Principal,
    taskId: string,
    status: TaskStatus,
  ): Promise<TaskRow | null>
  // Delete a task within the principal's write scope (#133, Slice B); the assignee rows cascade with
  // it. Returns true iff a row was removed, so an out-of-scope or unknown id removes nothing and is
  // reported as a miss — never confirming a task on another location's board exists.
  deleteTaskInScope(principal: Principal, taskId: string): Promise<boolean>
  // The assignee-location invariant's read (#133, Slice B): given the ids a write wants to assign and
  // the task's own location, return the ids that do NOT belong to that location — a user at another
  // location, a location-less admin, or an id naming no user at all. An empty result means every
  // assignee is in-location and the write may proceed; the service checks this before any write.
  assigneesOutsideLocation(userIds: string[], locationId: string): Promise<string[]>
  // The tasks-in-location invariant's read (#135, Slice D): given the ids a reorder wants to place and
  // the target location, return the ids that are NOT tasks on that location — a task on another board,
  // or an id naming no task at all. An empty result means every id is a task on this location and the
  // reorder may proceed; the service checks this before writing any position, so a mixed-location order
  // is refused rather than silently reindexed (the reorder twin of assigneesOutsideLocation).
  tasksOutsideLocation(taskIds: string[], locationId: string): Promise<string[]>
  // Rewrite the shared per-location manual order (#135, Slice D): assign each id in `orderedIds` its
  // list index as `position`, gated to `locationId` so a stray id from another board writes nothing —
  // defence in depth, since the service has already resolved the location from the principal and
  // checked every id belongs to it. Returns that location's tasks in the new canonical order (position,
  // id tiebreak), hydrated, so the caller and the live fan-out see exactly what a fresh scoped read
  // would. Location is resolved before this is called, so the method carries no scope predicate of its
  // own — a manager cannot reach here for another location because the service never hands one over.
  reorderTasks(locationId: string, orderedIds: string[]): Promise<TaskRow[]>
}

export function createTaskBoardRepository(db: Db): TaskBoardRepository {
  // Resolve the assignee set and the creator's rendered name (#258) for a batch of task rows in
  // two round trips and graft them back onto each row, so both the list read and the single-row
  // scoped read hydrate the identical way (assignees name-ordered for a stable render). Shared
  // here rather than duplicated so the two reads can never drift in how they shape a task.
  const hydrateAssignees = async (
    exec: Executor,
    rows: (typeof tasks.$inferSelect)[],
  ): Promise<TaskRow[]> => {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const assigneeRows = await exec
      .select({
        taskId: taskAssignees.taskId,
        id: users.id,
        displayName: users.displayName,
        assignedAt: taskAssignees.createdAt,
      })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, ids))
      .orderBy(asc(users.displayName), asc(users.id))

    const byTask = new Map<string, TaskAssigneeRow[]>()
    for (const row of assigneeRows) {
      const list = byTask.get(row.taskId)
      const assignee = { id: row.id, displayName: row.displayName, assignedAt: row.assignedAt }
      if (list) list.push(assignee)
      else byTask.set(row.taskId, [assignee])
    }

    // The creators' display names, one lookup for the batch's distinct ids. created_by is NOT NULL
    // with an FK to users and a user is deactivated, never deleted, so every id resolves; a miss
    // would mean referential corruption and fails loudly rather than shipping a nameless creator.
    const creatorIds = [...new Set(rows.map((row) => row.createdBy))]
    const creatorRows = await exec
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, creatorIds))
    const creatorById = new Map(creatorRows.map((row) => [row.id, row]))

    return rows.map((row) => {
      const creator = creatorById.get(row.createdBy)
      if (!creator) {
        throw new Error(`task ${row.id}: created_by ${row.createdBy} resolves to no user`)
      }
      return { ...row, assignees: byTask.get(row.id) ?? [], creator }
    })
  }

  // Insert an assignee set for a task, deduped, on the given handle. Deduping here is what keeps a
  // body naming the same user twice from tripping the (task_id, user_id) composite PK — a malformed
  // assignment resolves to "assigned once" rather than a 500. Shared by create and the reassignment
  // path so both shape the membership the identical way, the same drift-proofing hydrateAssignees uses.
  const insertAssignees = async (
    exec: Executor,
    taskId: string,
    userIds: string[],
  ): Promise<void> => {
    const unique = [...new Set(userIds)]
    if (unique.length === 0) return
    await exec.insert(taskAssignees).values(unique.map((userId) => ({ taskId, userId })))
  }

  return {
    projectInScope: async (principal, projectId) => {
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), projectScopePredicate(principal)))
        .limit(1)
      return rows.length > 0
    },

    listScopedTasks: async (principal) => {
      const rows = await db
        .select()
        .from(tasks)
        .where(taskScopePredicate(principal))
        // The shared manual order the board opens to; id is the stable tiebreak so equal
        // positions never reorder between reads.
        .orderBy(asc(tasks.position), asc(tasks.id))

      return hydrateAssignees(db, rows)
    },

    getScopedTask: async (principal, taskId) => {
      // The scope predicate AND the id, in one query: the row comes back only if the principal may
      // see it, so scope is enforced by the same predicate the list read trusts — never re-derived
      // from the principal here. No match (out of scope, or gone) is a plain null the fan-out reads
      // as "withhold". Employee scope re-evaluates the current assignee rows, so a reassignment is
      // honoured at delivery time: toward this user the row appears, away from them it turns null.
      const rows = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), taskScopePredicate(principal)))
        .limit(1)

      const hydrated = await hydrateAssignees(db, rows)
      return hydrated[0] ?? null
    },

    readLastSeen: async (userId) => {
      const rows = await db
        .select({ lastSeenAt: taskBoardLastSeen.lastSeenAt })
        .from(taskBoardLastSeen)
        .where(eq(taskBoardLastSeen.userId, userId))
        .limit(1)
      return rows[0]?.lastSeenAt ?? null
    },

    bumpLastSeen: async (userId, at) => {
      // Upsert the single per-user marker: first open inserts it, every later open advances it.
      await db
        .insert(taskBoardLastSeen)
        .values({ userId, lastSeenAt: at })
        .onConflictDoUpdate({
          target: taskBoardLastSeen.userId,
          set: { lastSeenAt: sql`excluded.last_seen_at` },
        })
    },

    createTask: (input) =>
      // One transaction for the row and its assignee set so a task never lands without the
      // membership a caller asked for, and hydrate on the same handle so the returned row already
      // carries the assignees just written. status/position fall to the column defaults
      // (`not_started`, 0) — a new task starts unstarted, and manual ordering is Slice D.
      db.transaction(async (tx) => {
        const inserted = await tx
          .insert(tasks)
          .values({
            locationId: input.locationId,
            createdBy: input.createdBy,
            title: input.title,
            description: input.description,
            priority: input.priority,
            dueDate: input.dueDate,
            projectId: input.projectId,
          })
          .returning()
        const row = inserted[0]
        if (!row) throw new Error('createTask: insert returned no row')
        await insertAssignees(tx, row.id, input.assigneeIds)
        const hydrated = await hydrateAssignees(tx, [row])
        const created = hydrated[0]
        if (!created) throw new Error('createTask: hydration returned no row')
        return created
      }),

    updateTaskInScope: (principal, taskId, input) =>
      db.transaction(async (tx) => {
        // The scope predicate rides in the WHERE, so a task outside the principal's write scope
        // matches nothing and returns no row — the update is the enforcement, not a separate check.
        const updated = await tx
          .update(tasks)
          .set({
            title: input.title,
            description: input.description,
            priority: input.priority,
            dueDate: input.dueDate,
            // status only when the edit carries it (#134, story 43): omitted, it stays out of the SET
            // so status is untouched and the completed_at trigger (which fires on writing status) does
            // not run; provided, it rides here and the trigger keeps completed_at honest.
            ...(input.status !== undefined ? { status: input.status } : {}),
            // Same optional-write rule as status: absent means "leave the filing alone".
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
            // A full edit bumps updatedAt; drizzle does not touch it on update, so set it explicitly.
            updatedAt: sql`now()`,
          })
          .where(and(eq(tasks.id, taskId), taskScopePredicate(principal)))
          .returning()
        const row = updated[0]
        if (!row) return null
        // Reconcile the assignee set by difference, not delete-all-then-insert: only genuinely
        // removed rows are deleted and only genuinely new ones inserted, so an unchanged assignee's
        // row — and its created_at — survives an edit. That column is a cross-slice contract (#129):
        // #59's Tasks-tab badge counts assignee rows newer than a user's last-seen marker, so churning
        // created_at on every edit (even a title-only one) would spuriously re-notify people already
        // on the task. An empty desired set removes everyone, landing the task in the backlog.
        const desired = new Set(input.assigneeIds)
        const currentRows = await tx
          .select({ userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(eq(taskAssignees.taskId, taskId))
        const current = new Set(currentRows.map((assignee) => assignee.userId))
        const toRemove = [...current].filter((userId) => !desired.has(userId))
        const toAdd = [...desired].filter((userId) => !current.has(userId))
        if (toRemove.length > 0) {
          await tx
            .delete(taskAssignees)
            .where(and(eq(taskAssignees.taskId, taskId), inArray(taskAssignees.userId, toRemove)))
        }
        await insertAssignees(tx, taskId, toAdd)
        const hydrated = await hydrateAssignees(tx, [row])
        return hydrated[0] ?? null
      }),

    updateTaskStatusInScope: async (principal, taskId, status) => {
      // The scope predicate rides in the WHERE, exactly as the full-update path does, so a task
      // outside the caller's scope matches nothing and returns no row — the update is the
      // enforcement, not a separate check. Only the status column is written (plus updatedAt); the
      // BEFORE trigger maintains completed_at from the new status, and RETURNING reflects it. No
      // transaction and no assignee reconciliation — a status write never touches the membership.
      const updated = await db
        .update(tasks)
        .set({ status, updatedAt: sql`now()` })
        .where(and(eq(tasks.id, taskId), taskScopePredicate(principal)))
        .returning()
      const row = updated[0]
      if (!row) return null
      const hydrated = await hydrateAssignees(db, [row])
      return hydrated[0] ?? null
    },

    deleteTaskInScope: async (principal, taskId) => {
      const deleted = await db
        .delete(tasks)
        .where(and(eq(tasks.id, taskId), taskScopePredicate(principal)))
        .returning({ id: tasks.id })
      return deleted.length > 0
    },

    assigneesOutsideLocation: async (userIds, locationId) => {
      if (userIds.length === 0) return []
      const rows = await db
        .select({ id: users.id, locationId: users.locationId })
        .from(users)
        .where(inArray(users.id, userIds))
      const inLocation = new Set(
        rows.filter((row) => row.locationId === locationId).map((row) => row.id),
      )
      // Any id not resolved to a user at this location is outside it — another location's user, a
      // location-less admin, or an id that names no user at all — and is returned as offending.
      return userIds.filter((id) => !inLocation.has(id))
    },

    tasksOutsideLocation: async (taskIds, locationId) => {
      if (taskIds.length === 0) return []
      const rows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(inArray(tasks.id, taskIds), eq(tasks.locationId, locationId)))
      const inLocation = new Set(rows.map((row) => row.id))
      // Any id not resolved to a task on this location is outside it — another board's task, or an id
      // that names no task at all — and is returned as offending.
      return taskIds.filter((id) => !inLocation.has(id))
    },

    reorderTasks: (locationId, orderedIds) =>
      // One transaction so the board never rests half-reordered. Each listed task takes its list index
      // as the new shared position — one write apiece, gated to the resolved location so an id from
      // another board (should one slip past the service check) still writes nothing. updatedAt is
      // bumped like every other write; the assignee membership is never touched by a reorder.
      db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
          await tx
            .update(tasks)
            .set({ position: index, updatedAt: sql`now()` })
            .where(and(eq(tasks.id, id), eq(tasks.locationId, locationId)))
        }
        const rows = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.locationId, locationId))
          .orderBy(asc(tasks.position), asc(tasks.id))
        return hydrateAssignees(tx, rows)
      }),
  }
}
