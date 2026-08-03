import type { Db } from '../db/client.js'
import { locations } from '../db/schema.js'

// The data-access seam for Location (#130 prefactor). One write for now — the seed/backfill
// path that puts a real `locations` row behind users.location_id's new FK — so a location and
// a user bound to it can be created through real code, not a raw INSERT. The task-board slices
// (Slice A onward) add the scoped read/write operations on top of this same repository.

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
  }
}
