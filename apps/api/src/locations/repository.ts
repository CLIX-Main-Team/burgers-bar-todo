import { VIEW_SCOPE_DEFAULTS } from '@burgers/shared'
import type { Role, ScopeChoice } from '@burgers/shared'
import { type SQL, and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { locations, projects, tasks, users } from '../db/schema.js'

// The principal's reach over the locations table (ADR-0007 tier two). Composed into the WHERE
// rather than filtered after the read, so an out-of-remit id resolves nothing instead of being
// fetched and then rejected. `view` is the owner's locations.view setting (2026-08-26), carried
// from the principal; absent, the role's default applies, which is the chain for a super_admin
// and one branch for everyone else — what this predicate did before the setting existed.
export interface LocationScope {
  role: Role
  locationId: string | null
  view?: ScopeChoice
}

// The rows this scope may see: the whole table on a chain horizon, one branch otherwise. A
// branch-held caller carrying no location matches nothing, which is the safe direction.
function scopePredicate(scope: LocationScope): SQL {
  const view = scope.view ?? VIEW_SCOPE_DEFAULTS['locations.view'][scope.role]
  if (view === 'chain') return sql`true`
  if (!scope.locationId) return sql`false`
  return eq(locations.id, scope.locationId)
}

// The data-access seam for Location. The seed/backfill write that puts a real `locations` row
// behind users.location_id's FK landed first (#130 prefactor); the admin locations API (#164, Slice
// L1) added list and rename alongside it, and the owner's 2026-08-16 ask adds delete — softening
// decision 4's "a Location is never removed" to "a Location is never removed *while anyone or
// anything is on it*". The users/tasks FKs still carry no `onDelete`, so the guard is explicit here:
// deleteLocation refuses while a user, a task or a project still references the branch, and this
// repository still exposes no way to orphan them.

// The outward view of a locations row: id, the human name, and the contact fields the branch
// detail page edits (2026-08-24, PR 2 task 1) — no timestamps a caller cares about.
export interface LocationRow {
  id: string
  name: string
  address: string | null
  city: string | null
  phone: string | null
}

// The columns every read path returns, named once so createLocation, listLocations and
// updateLocation cannot drift apart on what a "row" is.
const locationColumns = {
  id: locations.id,
  name: locations.name,
  address: locations.address,
  city: locations.city,
  phone: locations.phone,
}

// A patch over the branch record: an absent key leaves that column alone, an explicit null clears
// it. `name` carries no null — a branch must always be called something.
export interface UpdateLocationInput {
  name?: string
  address?: string | null
  city?: string | null
  phone?: string | null
}

export interface CreateLocationInput {
  name: string
  // An optional explicit id so a deterministic seed/backfill (and the integration harness)
  // can pin a known Location id; omitted, the table's uuid default assigns one.
  id?: string
}

export interface LocationRepository {
  createLocation(input: CreateLocationInput): Promise<LocationRow>
  // Every Location the scope reaches, ordered by name (#164; scoped 2026-08-23). The one
  // authoritative list the admin screen and both UI consumers read: the whole table for a
  // super_admin, the caller's own branch for anyone else.
  listLocations(scope: LocationScope): Promise<LocationRow[]>
  // Patch a Location by id (#164; widened to address/city/phone 2026-08-24), returning the updated
  // row, or null when no row has that id *within the scope* — either it truly does not exist, or it
  // exists outside the caller's reach, and the two are indistinguishable on purpose (2026-08-23) so
  // the route can answer both with the same 404 rather than letting a branch admin map the chain by
  // walking ids. Only the columns present on `patch` are written; everything references a Location
  // by id, so nothing else moves.
  updateLocation(
    id: string,
    patch: UpdateLocationInput,
    scope: LocationScope,
  ): Promise<LocationRow | null>
  // Delete a Location by id (owner ask 2026-08-16). Three outcomes, so the route can answer each
  // one honestly rather than collapsing them into a bare boolean: 'deleted' when the branch was
  // empty and is now gone, 'not_found' when no row has that id, and 'in_use' when a user, a task
  // or a project still references it — the FKs have no cascade, so deleting under them would
  // either fail at the database or strand real work. Emptying the branch is the admin's job, and
  // deliberately so: it is the step where the people and the work get somewhere to go.
  // Four outcomes, not three: a branch held by a project is refused for a different reason than
  // one held by people or tasks, and the caller has a different thing to go and do about it, so
  // collapsing the two would make the app tell a reader to move staff who are not there.
  deleteLocation(id: string): Promise<'deleted' | 'not_found' | 'in_use' | 'in_project'>
}

export function createLocationRepository(db: Db): LocationRepository {
  return {
    createLocation: async ({ name, id }) => {
      const rows = await db
        .insert(locations)
        .values(id === undefined ? { name } : { id, name })
        .returning(locationColumns)
      const row = rows[0]
      // A plain insert (no conflict clause) always returns its one row; guard so the type is
      // honest and a silent empty return can never masquerade as a created Location.
      if (!row) {
        throw new Error('createLocation: insert returned no row')
      }
      return row
    },
    listLocations: async (scope) =>
      db
        .select(locationColumns)
        .from(locations)
        .where(scopePredicate(scope))
        .orderBy(asc(locations.name)),
    updateLocation: async (id, patch, scope) => {
      const set: Partial<typeof locations.$inferInsert> = { updatedAt: new Date() }
      // Only keys the caller actually sent are written. `in` rather than a truthiness test, so an
      // explicit null clears the column while an omitted key leaves it untouched.
      if ('name' in patch && patch.name !== undefined) set.name = patch.name
      if ('address' in patch) set.address = patch.address
      if ('city' in patch) set.city = patch.city
      if ('phone' in patch) set.phone = patch.phone

      const rows = await db
        .update(locations)
        .set(set)
        .where(and(eq(locations.id, id), scopePredicate(scope)))
        .returning(locationColumns)
      // No matching row means either the id does not exist or it exists outside the scope — hand
      // back null either way so the route emits the same 404 instead of a 200 that would falsely
      // confirm a patch that changed nothing.
      return rows[0] ?? null
    },
    deleteLocation: async (id) => {
      // One transaction so the emptiness the delete is authorised by is the emptiness it deletes
      // under: without it, a user could be staffed at the branch between the check and the delete
      // and the FK would refuse the write anyway — as a 500 rather than the honest 409.
      return db.transaction(async (tx) => {
        const staffed = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.locationId, id))
          .limit(1)
        const worked = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.locationId, id))
          .limit(1)
        // A project names its branches in a uuid ARRAY, which means no foreign key is holding this
        // one down. Without this check a deleted branch would leave an id pointing at nothing —
        // and a project that named only that branch would empty out, which is how this table says
        // "chain-wide". Losing a branch would quietly widen a project to the whole chain.
        const planned = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(sql`${id}::uuid = any(${projects.locationIds})`)
          .limit(1)
        // People and work first: they are the blockers a reader can act on from this page, and
        // clearing them is the same move for both. A project is reported on its own because the
        // fix lives on another screen entirely.
        if (staffed.length > 0 || worked.length > 0) {
          return 'in_use'
        }
        if (planned.length > 0) {
          return 'in_project'
        }
        const removed = await tx
          .delete(locations)
          .where(eq(locations.id, id))
          .returning({ id: locations.id })
        return removed.length > 0 ? 'deleted' : 'not_found'
      })
    },
  }
}
