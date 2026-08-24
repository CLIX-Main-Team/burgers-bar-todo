import type { Location } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { locationsApi } from '../../lib/api.js'

// The one query key for the authoritative Location list (GET /locations, #164). Both L3
// consumers — the invite picker and the task-form board list — and the L2 screen read this
// single key, so a create or rename in L2 invalidates it once and every reader refreshes
// together, instead of each place deriving locations from its own "distinct ids in the
// people list" hack.
export const LOCATIONS_QUERY_KEY = ['locations'] as const

async function fetchLocations(): Promise<Location[]> {
  const response = await locationsApi.list()
  return response.locations
}

// The shared Location-list query. The endpoint is Admin-only (ADR-0007 — a manager or
// employee is a flat 403), and the only surfaces that need it (the admin invite picker, the
// admin task-form board choice) are admin-gated already, so the caller passes `enabled` to
// keep the query from firing for a principal the API would refuse. Returns the raw query so
// a consumer can branch on pending/error/empty for its own empty-state and loading copy.
export function useLocations({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: fetchLocations,
    enabled,
  })
}

// The branch detail page's read (Task 3, round 12): the same key and queryFn as useLocations,
// so a viewer who arrived from the list reads the cache that's already there and costs no
// second network call, while a viewer who lands on `/locations/:id` directly still resolves —
// TanStack Query fetches into that one shared cache entry rather than a second one. `select`
// narrows the cached array to the single branch: undefined while that first read is still
// pending, null once it has settled if no branch in it carries this id.
export function useLocation(id: string): Location | null | undefined {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: fetchLocations,
    select: (locations) => locations.find((location) => location.id === id) ?? null,
  }).data
}
