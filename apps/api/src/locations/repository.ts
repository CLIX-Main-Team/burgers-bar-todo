import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { locations, tasks, users } from '../db/schema.js'

// The data-access seam for Location. The seed/backfill write that puts a real `locations` row
// behind users.location_id's FK landed first (#130 prefactor); the admin locations API (#164, Slice
// L1) added list and rename alongside it, and the owner's 2026-08-16 ask adds delete — softening
// decision 4's "a Location is never removed" to "a Location is never removed *while anyone or
// anything is on it*". The users/tasks FKs still carry no `onDelete`, so the guard is explicit here:
// deleteLocation refuses while a user or a task still references the branch, and this repository
// still exposes no way to orphan them.

// The outward view of a locations row: id and the human name, no timestamps a caller cares
// about at create time.
export interface LocationRow {
  id: string
  name: string
}

export interface CreateLocationInput {
  name: string
  // An optional explicit id so a deterministic seed/backfill (and the integration harness)
  // can pin a known Location id; omitted, the table's uuid default assigns one.
  id?: string
}

export interface LocationRepository {
  createLocation(input: CreateLocationInput): Promise<LocationRow>
  // Every Location, ordered by name (#164). The one authoritative list the admin screen and both UI
  // consumers read; there is no scope — the whole table is an admin's to see — so it takes no
  // principal or filter.
  listLocations(): Promise<LocationRow[]>
  // Rename a Location by id (#164), returning the updated row, or null when no row has that id so
  // the route can answer a rename of an unknown id with a 404 rather than a silent no-op success. A
  // rename touches only the name column; everything references a Location by id, so nothing else
  // moves.
  renameLocation(id: string, name: string): Promise<LocationRow | null>
  // Delete a Location by id (owner ask 2026-08-16). Three outcomes, so the route can answer each
  // one honestly rather than collapsing them into a bare boolean: 'deleted' when the branch was
  // empty and is now gone, 'not_found' when no row has that id, and 'in_use' when a user or a task
  // still references it — the FKs have no cascade, so deleting under them would either fail at the
  // database or strand real work. Emptying the branch is the admin's job, and deliberately so: it
  // is the step where the people and the work get somewhere to go.
  deleteLocation(id: string): Promise<'deleted' | 'not_found' | 'in_use'>
}

export function createLocationRepository(db: Db): LocationRepository {
  return {
    createLocation: async ({ name, id }) => {
      const rows = await db
        .insert(locations)
        .values(id === undefined ? { name } : { id, name })
        .returning({ id: locations.id, name: locations.name })
      const row = rows[0]
      // A plain insert (no conflict clause) always returns its one row; guard so the type is
      // honest and a silent empty return can never masquerade as a created Location.
      if (!row) {
        throw new Error('createLocation: insert returned no row')
      }
      return row
    },
    listLocations: () =>
      db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .orderBy(asc(locations.name)),
    renameLocation: async (id, name) => {
      const rows = await db
        .update(locations)
        .set({ name })
        .where(eq(locations.id, id))
        .returning({ id: locations.id, name: locations.name })
      // No matching row means the id does not exist — hand back null so the route emits a 404
      // instead of a 200 that would falsely confirm a rename that changed nothing.
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
        if (staffed.length > 0 || worked.length > 0) {
          return 'in_use'
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
