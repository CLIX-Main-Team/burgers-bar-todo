import { ALWAYS_INVOLVED_PROJECT_ROLES, type Role, projectReachesUser } from '@burgers/shared'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { type Principal, viewScope } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import {
  locations,
  projectChecklistItemAssignees,
  projectChecklistItems,
  projects,
  users,
} from '../db/schema.js'
import { projectScopePredicate } from './scope.js'

export interface ProjectUserRow {
  id: string
  displayName: string
}

// A checklist row plus whoever owns it. The owners are a separate table, so they are stitched on
// by the read rather than selected with the row.
export type ChecklistItemRow = typeof projectChecklistItems.$inferSelect & {
  assignees: ProjectUserRow[]
}

// One person a step may be handed to. Their branch rides along because the picker groups by it.
export interface ProjectCandidateRow {
  id: string
  displayName: string
  role: Role
  locationId: string | null
  locationName: string | null
}

// A project row plus everything the screens render, including the two DERIVED figures the table
// deliberately does not store: how many of its checklist items are ticked, and how many there are.
export type ProjectRow = typeof projects.$inferSelect & {
  // The branches the project names, resolved to names. Empty is the chain-wide case.
  locations: ProjectBranchRow[]
  creator: ProjectUserRow
  doneCount: number
  taskCount: number
  // Un-ticked steps on this project belonging to whoever asked for it. Per-viewer, so it is the
  // one field on this row two people reading the same project legitimately disagree about.
  myOpenSteps: number
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
  // The checklist, in its own manual order, each line carrying its owners.
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
  // Everyone this project reaches, narrowed to the people the principal may already see. The
  // picker's whole content, and the set the write below re-checks against.
  listCandidates(principal: Principal, project: ProjectRow): Promise<ProjectCandidateRow[]>
  // Replace one step's owners. Returns false when the item does not belong to the project, which
  // is the same answer as "no such item" — an id from another project must never confirm a row.
  setChecklistItemAssignees(projectId: string, itemId: string, userIds: string[]): Promise<boolean>
  // Drop assignments held by people the project no longer reaches. Run after a project's roles or
  // branches change; see the call site in service.ts for why the rows go rather than linger.
  pruneAssigneesOutOfScope(project: ProjectRow): Promise<void>
}

export function createProjectRepository(db: Db): ProjectRepository {
  // The counts, computed in the database rather than by loading every item into Node. A project
  // with no checklist yields 0/0, which is the case that decides it reads as "not started" rather
  // than "done" upstream.
  async function hydrate(
    rows: (typeof projects.$inferSelect)[],
    // Whose open-step count to compute. The counts below are the project's; this one is the
    // reader's, which is why it has to be passed in rather than derived from the row.
    viewerId: string,
  ): Promise<ProjectRow[]> {
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

    // The card's red counter, counted in the database for the same reason the two above are: the
    // grid draws it for every project on the page, and loading each checklist to count in Node
    // would be one round trip per card.
    const mine = await db
      .select({
        projectId: projectChecklistItems.projectId,
        openCount: sql<number>`count(*)::int`,
      })
      .from(projectChecklistItemAssignees)
      .innerJoin(
        projectChecklistItems,
        eq(projectChecklistItems.id, projectChecklistItemAssignees.itemId),
      )
      .where(
        and(
          inArray(projectChecklistItems.projectId, ids),
          eq(projectChecklistItemAssignees.userId, viewerId),
          eq(projectChecklistItems.done, false),
        ),
      )
      .groupBy(projectChecklistItems.projectId)
    const openByProject = new Map(mine.map((entry) => [entry.projectId, entry.openCount]))

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
        myOpenSteps: openByProject.get(row.id) ?? 0,
      }
    })
  }

  // Stitch each line's owners on. One query for the whole checklist rather than one per line, and
  // sorted by display name here rather than in the client, so two clients render one avatar stack
  // in the same order.
  async function withAssignees(
    items: (typeof projectChecklistItems.$inferSelect)[],
  ): Promise<ChecklistItemRow[]> {
    if (items.length === 0) return []
    const rows = await db
      .select({
        itemId: projectChecklistItemAssignees.itemId,
        id: users.id,
        displayName: users.displayName,
      })
      .from(projectChecklistItemAssignees)
      .innerJoin(users, eq(users.id, projectChecklistItemAssignees.userId))
      .where(
        inArray(
          projectChecklistItemAssignees.itemId,
          items.map((item) => item.id),
        ),
      )
      .orderBy(asc(users.displayName))

    const byItem = new Map<string, ProjectUserRow[]>()
    for (const row of rows) {
      const list = byItem.get(row.itemId)
      const person = { id: row.id, displayName: row.displayName }
      if (list) list.push(person)
      else byItem.set(row.itemId, [person])
    }
    return items.map((item) => ({ ...item, assignees: byItem.get(item.id) ?? [] }))
  }

  return {
    async list(principal) {
      const rows = await db
        .select()
        .from(projects)
        .where(projectScopePredicate(principal))
        .orderBy(asc(projects.createdAt))
      return hydrate(rows, principal.userId)
    },

    // Scoped by the same predicate as the list: a project outside the principal's scope is
    // indistinguishable from one that does not exist, so an id never confirms a row elsewhere.
    async findById(principal, id) {
      const rows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), projectScopePredicate(principal)))
        .limit(1)
      const hydrated = await hydrate(rows, principal.userId)
      return hydrated[0] ?? null
    },

    async create(principal, input) {
      const [row] = await db.insert(projects).values(input).returning()
      const hydrated = await hydrate([row as typeof projects.$inferSelect], principal.userId)
      return hydrated[0] as ProjectRow
    },

    async update(principal, id, input) {
      const [row] = await db
        .update(projects)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning()
      if (!row) return null
      const hydrated = await hydrate([row], principal.userId)
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

    async listChecklist(projectId) {
      const items = await db
        .select()
        .from(projectChecklistItems)
        .where(eq(projectChecklistItems.projectId, projectId))
        .orderBy(asc(projectChecklistItems.position), asc(projectChecklistItems.createdAt))
      return withAssignees(items)
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
      // A line that was typed a moment ago has nobody on it yet.
      return { ...(row as typeof projectChecklistItems.$inferSelect), assignees: [] }
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
      if (!row) return null
      const [hydrated] = await withAssignees([row])
      return hydrated ?? null
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

    // Who this project reaches, narrowed to who the asker may see.
    //
    // The role and place axes are `projectReachesUser` — the scope predicate read forwards — and
    // are applied in SQL rather than in Node because the alternative is loading every user in the
    // chain to filter forty-six branches down to one.
    //
    // The third axis is the asker's own horizon (owner call 2026-08-28): a branch admin opening a
    // chain-wide project offers their own branch's people, not the chain's. Two admins therefore
    // see different name lists on the same project, which is the same shape as every other scope
    // rule here — a branch admin answers for a place.
    async listCandidates(principal, project) {
      const chainWide = project.locationIds.length === 0
      // Deactivated and still-invited accounts are not people you can hand work to.
      const clauses = [eq(users.status, 'active')]

      // The role axis. The two always-involved roles are in regardless of what the project's own
      // list says, because the branch picker is what names them (shared: projectReachesUser).
      // `roles` is a text[] column, so it arrives as string[]; the response schema is what
      // validates a retired value on the way out (routes/projects.ts).
      const namedRoles = [
        ...new Set([...project.roles, ...ALWAYS_INVOLVED_PROJECT_ROLES]),
      ] as Role[]
      clauses.push(inArray(users.role, namedRoles))

      // The place axis. A chain-wide project reaches everybody including the branch-less HQ
      // roles; a project naming branches reaches only those branches, and nobody branch-less —
      // the fail-closed half of the scope predicate, which never falls back to another branch.
      if (!chainWide) clauses.push(inArray(users.locationId, project.locationIds))

      // The asker's own horizon. A null location matches nothing rather than widening the view,
      // the safe direction — the same choice listUsers makes.
      const horizon = viewScope(principal, 'users.view')
      if (horizon !== 'chain') clauses.push(eq(users.locationId, principal.locationId as string))

      return db
        .select({
          id: users.id,
          displayName: users.displayName,
          role: users.role,
          locationId: users.locationId,
          locationName: locations.name,
        })
        .from(users)
        .leftJoin(locations, eq(locations.id, users.locationId))
        .where(and(...clauses))
        .orderBy(asc(users.displayName))
    },

    // Wholesale replace, in a transaction: a delete followed by an insert that failed would leave
    // a step with nobody on it, which reads as "unassigned" rather than as "the write broke".
    //
    // The project id rides in the item lookup, so an item id belonging to another project matches
    // nothing — the scope check the caller already did on the project covers its items for free.
    async setChecklistItemAssignees(projectId, itemId, userIds) {
      const [item] = await db
        .select({ id: projectChecklistItems.id })
        .from(projectChecklistItems)
        .where(
          and(eq(projectChecklistItems.id, itemId), eq(projectChecklistItems.projectId, projectId)),
        )
        .limit(1)
      if (!item) return false

      const unique = [...new Set(userIds)]
      await db.transaction(async (tx) => {
        await tx
          .delete(projectChecklistItemAssignees)
          .where(eq(projectChecklistItemAssignees.itemId, itemId))
        if (unique.length > 0) {
          await tx
            .insert(projectChecklistItemAssignees)
            .values(unique.map((userId) => ({ itemId, userId })))
        }
      })
      return true
    },

    // The rows go rather than linger. A person still standing on a step of a project they can no
    // longer open is worse than a lost assignment: it reads as work that is somebody's when it is
    // nobody's, and the person it names cannot see it to say so.
    //
    // Filtered in Node through `projectReachesUser`, the shared predicate, rather than by a second
    // hand-written WHERE. The set being filtered is only the people currently standing on THIS
    // project's steps — a handful, not a chain — so there is nothing to gain by pushing it down,
    // and everything to lose: two expressions of "who does a project reach" is how they start
    // disagreeing.
    async pruneAssigneesOutOfScope(project) {
      const standing = await db
        .selectDistinct({
          userId: projectChecklistItemAssignees.userId,
          role: users.role,
          locationId: users.locationId,
        })
        .from(projectChecklistItemAssignees)
        .innerJoin(
          projectChecklistItems,
          eq(projectChecklistItems.id, projectChecklistItemAssignees.itemId),
        )
        .innerJoin(users, eq(users.id, projectChecklistItemAssignees.userId))
        .where(eq(projectChecklistItems.projectId, project.id))

      const evicted = standing
        .filter(
          (person) =>
            !projectReachesUser(
              { roles: project.roles as Role[], locationIds: project.locationIds },
              { role: person.role, locationId: person.locationId },
            ),
        )
        .map((person) => person.userId)
      if (evicted.length === 0) return

      const items = await db
        .select({ id: projectChecklistItems.id })
        .from(projectChecklistItems)
        .where(eq(projectChecklistItems.projectId, project.id))

      await db.delete(projectChecklistItemAssignees).where(
        and(
          inArray(
            projectChecklistItemAssignees.itemId,
            items.map((item) => item.id),
          ),
          inArray(projectChecklistItemAssignees.userId, evicted),
        ),
      )
    },
  }
}
