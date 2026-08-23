import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import { locations, projects, taskAssignees, tasks, users } from '../db/schema.js'
import { taskScopePredicate } from '../task-board/scope.js'
import { projectScopePredicate } from './scope.js'

// A rendered user reference, the same bare pair the board hydrates.
export interface ProjectUserRow {
  id: string
  displayName: string
}

// A project row with everything the screens render, including the three DERIVED figures the
// table deliberately does not store: how many of its tasks are done, how many there are, and
// who is actually carrying them.
export type ProjectRow = typeof projects.$inferSelect & {
  locationName: string | null
  lead: ProjectUserRow | null
  creator: ProjectUserRow
  doneCount: number
  taskCount: number
  team: ProjectUserRow[]
}

export interface CreateProjectInput {
  locationId: string | null
  createdBy: string
  name: string
  icon: string
  colour: string
  leadId: string | null
  startDate: Date | null
  targetDate: Date | null
  phase: string | null
}

export interface UpdateProjectInput {
  name: string
  icon: string
  colour: string
  leadId: string | null
  startDate: Date | null
  targetDate: Date | null
  phase: string | null
}

export interface ProjectRepository {
  list(principal: Principal): Promise<ProjectRow[]>
  findById(principal: Principal, id: string): Promise<ProjectRow | null>
  // The principal rides along on the writes too, only so the row that comes back is hydrated
  // through the same scope as a read — the client renders the create response directly, and it
  // must not briefly show a manager counts they would never see on a refresh.
  create(principal: Principal, input: CreateProjectInput): Promise<ProjectRow>
  update(principal: Principal, id: string, input: UpdateProjectInput): Promise<ProjectRow | null>
  remove(id: string): Promise<boolean>
}

export function createProjectRepository(db: Db): ProjectRepository {
  // The counts, computed in the database rather than by loading every task into Node. A project
  // with no tasks yields 0/0, which is the case that decides it reads as "not started" rather
  // than "done" upstream.
  //
  // The counts are filtered by the TASK scope predicate, not just the project one, and that is
  // deliberate: a chain-wide project holds tasks from several branches, and a manager only sees
  // their own branch's. Counting every task would print "13 of 13" above a list of four, which is
  // the kind of disagreement people file bugs about. So the number always describes exactly the
  // rows the same principal would be shown — their slice of the project.
  async function hydrate(
    principal: Principal,
    rows: (typeof projects.$inferSelect)[],
  ): Promise<ProjectRow[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const counts = await db
      .select({
        projectId: tasks.projectId,
        taskCount: sql<number>`count(*)::int`,
        doneCount: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
      })
      .from(tasks)
      .where(and(inArray(tasks.projectId, ids), taskScopePredicate(principal)))
      .groupBy(tasks.projectId)

    // The team is who is actually assigned work inside the project — derived, never a stored
    // membership list somebody has to remember to prune when a person moves on.
    const team = await db
      .selectDistinct({
        projectId: tasks.projectId,
        id: users.id,
        displayName: users.displayName,
      })
      .from(tasks)
      .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(and(inArray(tasks.projectId, ids), taskScopePredicate(principal)))
      .orderBy(asc(users.displayName))

    // One lookup for every person and branch named across the whole page, rather than a join per
    // project row.
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.createdBy, row.leadId])
          .filter((id): id is string => id !== null),
      ),
    ]
    const people = userIds.length
      ? await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds))
      : []
    const byUser = new Map(people.map((person) => [person.id, person]))

    const locationIds = [
      ...new Set(rows.map((row) => row.locationId).filter((id): id is string => id !== null)),
    ]
    const branches = locationIds.length
      ? await db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, locationIds))
      : []
    const byLocation = new Map(branches.map((branch) => [branch.id, branch.name]))

    return rows.map((row) => {
      const count = counts.find((entry) => entry.projectId === row.id)
      return {
        ...row,
        locationName: row.locationId ? (byLocation.get(row.locationId) ?? null) : null,
        lead: row.leadId ? (byUser.get(row.leadId) ?? null) : null,
        // created_by is NOT NULL and users are never deleted, so the name always resolves; the
        // fallback exists only so a corrupt row cannot crash the whole list.
        creator: byUser.get(row.createdBy) ?? { id: row.createdBy, displayName: '' },
        doneCount: count?.doneCount ?? 0,
        taskCount: count?.taskCount ?? 0,
        team: team
          .filter((member) => member.projectId === row.id)
          .map(({ id, displayName }) => ({ id, displayName })),
      }
    })
  }

  return {
    async list(principal) {
      const rows = await db
        .select()
        .from(projects)
        .where(projectScopePredicate(principal))
        .orderBy(asc(projects.createdAt))
      return hydrate(principal, rows)
    },

    // Scoped by the same predicate as the list: a project outside the principal's scope is
    // indistinguishable from one that does not exist, so an id never confirms a row elsewhere.
    async findById(principal, id) {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), projectScopePredicate(principal)))
        .limit(1)
      const hydrated = await hydrate(principal, rows)
      return hydrated[0] ?? null
    },

    async create(principal, input) {
      const [row] = await db.insert(projects).values(input).returning()
      // The insert always returns the row it just wrote.
      const hydrated = await hydrate(principal, [row as typeof projects.$inferSelect])
      return hydrated[0] as ProjectRow
    },

    async update(principal, id, input) {
      const [row] = await db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning()
      if (!row) return null
      const hydrated = await hydrate(principal, [row])
      return hydrated[0] ?? null
    },

    // The FK is `on delete set null`, so the project's tasks survive this and return to the
    // board unfiled. Nothing here touches the tasks table.
    async remove(id) {
      const removed = await db
        .delete(projects)
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
      return removed.length > 0
    },
  }
}
