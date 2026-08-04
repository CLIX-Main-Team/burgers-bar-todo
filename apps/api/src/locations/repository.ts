import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { locations } from '../db/schema.js'

// The data-access seam for Location. The seed/backfill write that puts a real `locations` row
// behind users.location_id's FK landed first (#130 prefactor); the admin locations API (#164, Slice
// L1) adds the list and rename operations alongside it — the three data-access operations the
// admin `/locations` surface is built from. There is no delete or deactivate (decision 4): a
// Location is never removed, so the users/tasks FKs carry no `onDelete` and this repository exposes
// no way to orphan them.

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
  }
}
