import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import { taskAssignees, taskBoardLastSeen, tasks, users } from '../db/schema.js'
import { taskScopePredicate } from './scope.js'

// One assignee on a task as the board reads it: identity plus the display name it renders.
export interface TaskAssigneeRow {
  id: string
  displayName: string
}

// A task row plus its resolved assignee set. The base fields are inferred straight from the
// `tasks` table so this type never drifts from the schema.
export type TaskRow = typeof tasks.$inferSelect & {
  assignees: TaskAssigneeRow[]
}

// The task-board data-access seam (ADR-0007 tier two). Every task read goes through
// `listScopedTasks`, which applies the central scope predicate — there is deliberately no
// unscoped "list all tasks" method for a caller to reach. The last-seen pair backs the
// board-view trigger (#131 owns the trigger; #59 the badge).
export interface TaskBoardRepository {
  // The scoped board read: tasks the principal may see, in the shared manual order (position,
  // then a stable id tiebreak), each carrying its assignee set. The priority sort is applied
  // client-side over this list, so the order here is always the manual one.
  listScopedTasks(principal: Principal): Promise<TaskRow[]>
  // This user's board last-seen marker, or null if they have never opened the board.
  readLastSeen(userId: string): Promise<Date | null>
  // Advance (or create) this user's board last-seen marker to `at`.
  bumpLastSeen(userId: string, at: Date): Promise<void>
}

export function createTaskBoardRepository(db: Db): TaskBoardRepository {
  return {
    listScopedTasks: async (principal) => {
      const rows = await db
        .select()
        .from(tasks)
        .where(taskScopePredicate(principal))
        // The shared manual order the board opens to; id is the stable tiebreak so equal
        // positions never reorder between reads.
        .orderBy(asc(tasks.position), asc(tasks.id))

      if (rows.length === 0) return []

      // Resolve every returned task's assignees in one round trip, joined to users for the
      // display name, and grouped back onto each task. Ordered by name so a task's assignee
      // list renders in a stable order.
      const ids = rows.map((row) => row.id)
      const assigneeRows = await db
        .select({
          taskId: taskAssignees.taskId,
          id: users.id,
          displayName: users.displayName,
        })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(inArray(taskAssignees.taskId, ids))
        .orderBy(asc(users.displayName), asc(users.id))

      const byTask = new Map<string, TaskAssigneeRow[]>()
      for (const row of assigneeRows) {
        const list = byTask.get(row.taskId)
        const assignee = { id: row.id, displayName: row.displayName }
        if (list) list.push(assignee)
        else byTask.set(row.taskId, [assignee])
      }

      return rows.map((row) => ({ ...row, assignees: byTask.get(row.id) ?? [] }))
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
  }
}
