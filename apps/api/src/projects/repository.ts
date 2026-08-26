import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import { locations, projectChecklistItems, projects, users } from '../db/schema.js'
import { projectScopePredicate } from './scope.js'

export interface ProjectUserRow {
  id: string
  displayName: string
}

export type ChecklistItemRow = typeof projectChecklistItems.$inferSelect

// A project row plus everything the screens render, including the two DERIVED figures the table
// deliberately does not store: how many of its checklist items are ticked, and how many there are.
export type ProjectRow = typeof projects.$inferSelect & {
  // The branches the project names, resolved to names. Empty is the chain-wide case.
  locations: ProjectBranchRow[]
  creator: ProjectUserRow
  doneCount: number
  taskCount: number
}

export interface ProjectBranchRow {
  id: string
  name: string
}

export interface CreateProjectInput {
  locationIds: string[]
  createdBy: string
  name: string
  icon: string
  colour: string
  roles: string[]
  startDate: Date | null
  targetDate: Date | null
  phase: string
}

export interface UpdateProjectInput {
  name: string
  icon: string
  colour: string
  locationIds: string[]
  roles: string[]
  startDate: Date | null
  targetDate: Date | null
  phase: string
}

export interface ProjectRepository {
  list(principal: Principal): Promise<ProjectRow[]>
  findById(principal: Principal, id: string): Promise<ProjectRow | null>
  create(principal: Principal, input: CreateProjectInput): Promise<ProjectRow>
  update(principal: Principal, id: string, input: UpdateProjectInput): Promise<ProjectRow | null>
  remove(id: string): Promise<boolean>
  // The checklist, in its own manual order.
  listChecklist(projectId: string): Promise<ChecklistItemRow[]>
  addChecklistItem(projectId: string, title: string): Promise<ChecklistItemRow>
  // Write a whole checklist at once, in the order given. The single-item add is a person typing a
  // line; this is a project created from a template, and doing it one row at a time would be two
  // round-trips per line — eighty of them for the forty-step opening checklist (2026-08-26).
  addChecklistItems(projectId: string, titles: string[]): Promise<void>
  setChecklistItemDone(
    projectId: string,
    itemId: string,
    done: boolean,
  ): Promise<ChecklistItemRow | null>
  removeChecklistItem(projectId: string, itemId: string): Promise<boolean>
  // Move a project's phase without going through the full update — how the automatic
  // completed / un-completed move is applied when the checklist crosses fully-ticked.
  setPhase(projectId: string, phase: string): Promise<void>
}

export function createProjectRepository(db: Db): ProjectRepository {
  // The counts, computed in the database rather than by loading every item into Node. A project
  // with no checklist yields 0/0, which is the case that decides it reads as "not started" rather
  // than "done" upstream.
  async function hydrate(rows: (typeof projects.$inferSelect)[]): Promise<ProjectRow[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)

    const counts = await db
      .select({
        projectId: projectChecklistItems.projectId,
        taskCount: sql<number>`count(*)::int`,
        doneCount: sql<number>`count(*) filter (where ${projectChecklistItems.done})::int`,
      })
      .from(projectChecklistItems)
      .where(inArray(projectChecklistItems.projectId, ids))
      .groupBy(projectChecklistItems.projectId)

    // One lookup for every person and branch named across the whole page, rather than a join per
    // project row.
    const userIds = [...new Set(rows.map((row) => row.createdBy))]
    const people = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds))
    const byUser = new Map(people.map((person) => [person.id, person]))

    const locationIds = [...new Set(rows.flatMap((row) => row.locationIds))]
    const branches = locationIds.length
      ? await db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, locationIds))
      : []
    const byLocation = new Map(branches.map((branch) => [branch.id, branch]))

    return rows.map((row) => {
      const count = counts.find((entry) => entry.projectId === row.id)
      return {
        ...row,
        // In the branch list's own alphabetical order rather than the order they were ticked, so
        // the same two branches read the same way on every project. An id with no row behind it is
        // dropped rather than rendered blank; the delete guard in locations/repository.ts is what
        // stops one being created in the first place.
        locations: row.locationIds
          .map((id) => byLocation.get(id))
          .filter((branch): branch is ProjectBranchRow => branch !== undefined)
          .sort((a, b) => a.name.localeCompare(b.name)),
        // created_by is NOT NULL and users are never deleted, so the name always resolves; the
        // fallback exists only so a corrupt row cannot crash the whole list.
        creator: byUser.get(row.createdBy) ?? { id: row.createdBy, displayName: '' },
        doneCount: count?.doneCount ?? 0,
        taskCount: count?.taskCount ?? 0,
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
      return hydrate(rows)
    },

    // Scoped by the same predicate as the list: a project outside the principal's scope is
    // indistinguishable from one that does not exist, so an id never confirms a row elsewhere.
    async findById(principal, id) {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), projectScopePredicate(principal)))
        .limit(1)
      const hydrated = await hydrate(rows)
      return hydrated[0] ?? null
    },

    async create(_principal, input) {
      const [row] = await db.insert(projects).values(input).returning()
      const hydrated = await hydrate([row as typeof projects.$inferSelect])
      return hydrated[0] as ProjectRow
    },

    async update(_principal, id, input) {
      const [row] = await db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning()
      if (!row) return null
      const hydrated = await hydrate([row])
      return hydrated[0] ?? null
    },

    // The checklist cascades with the project (the FK says so), so nothing here deletes it by
    // hand. Board tasks that happen to reference the project are a separate matter and survive.
    async remove(id) {
      const removed = await db
        .delete(projects)
        .where(eq(projects.id, id))
        .returning({ id: projects.id })
      return removed.length > 0
    },

    listChecklist(projectId) {
      return db
        .select()
        .from(projectChecklistItems)
        .where(eq(projectChecklistItems.projectId, projectId))
        .orderBy(asc(projectChecklistItems.position), asc(projectChecklistItems.createdAt))
    },

    async addChecklistItem(projectId, title) {
      // New items land at the end. `max + 1` rather than a count, so deleting from the middle
      // never makes two items share a position.
      const [last] = await db
        .select({
          position: sql<number>`coalesce(max(${projectChecklistItems.position}), -1)::int`,
        })
        .from(projectChecklistItems)
        .where(eq(projectChecklistItems.projectId, projectId))
      const [row] = await db
        .insert(projectChecklistItems)
        .values({ projectId, title, position: (last?.position ?? -1) + 1 })
        .returning()
      return row as ChecklistItemRow
    },

    // Positions continue from whatever is already there, so a template written onto a project that
    // somebody has already typed a line into appends rather than colliding with it.
    async addChecklistItems(projectId, titles) {
      if (titles.length === 0) return
      const [last] = await db
        .select({
          position: sql<number>`coalesce(max(${projectChecklistItems.position}), -1)::int`,
        })
        .from(projectChecklistItems)
        .where(eq(projectChecklistItems.projectId, projectId))
      const start = (last?.position ?? -1) + 1
      await db
        .insert(projectChecklistItems)
        .values(titles.map((title, index) => ({ projectId, title, position: start + index })))
    },

    async setChecklistItemDone(projectId, itemId, done) {
      // The project id rides in the WHERE, so an item id from another project matches nothing —
      // the scope check the caller already did on the project covers its items for free.
      const [row] = await db
        .update(projectChecklistItems)
        .set({ done, updatedAt: new Date() })
        .where(
          and(eq(projectChecklistItems.id, itemId), eq(projectChecklistItems.projectId, projectId)),
        )
        .returning()
      return row ?? null
    },

    async removeChecklistItem(projectId, itemId) {
      const removed = await db
        .delete(projectChecklistItems)
        .where(
          and(eq(projectChecklistItems.id, itemId), eq(projectChecklistItems.projectId, projectId)),
        )
        .returning({ id: projectChecklistItems.id })
      return removed.length > 0
    },

    async setPhase(projectId, phase) {
      await db
        .update(projects)
        .set({ phase, updatedAt: new Date() })
        .where(eq(projects.id, projectId))
    },
  }
}
