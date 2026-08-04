import type { Location } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { locationsApi } from '../../lib/api.js'

// The one query key for the authoritative Location list (GET /locations, #164). Both L3
// consumers — the invite picker and the task-form board list — and the L2 screen read this
// single key, so a create or rename in L2 invalidates it once and every reader refreshes
// together, instead of each place deriving locations from its own "distinct ids in the
// people list" hack.
export const LOCATIONS_QUERY_KEY = ['locations'] as const

// The shared Location-list query. The endpoint is Admin-only (ADR-0007 — a manager or
// employee is a flat 403), and the only surfaces that need it (the admin invite picker, the
// admin task-form board choice) are admin-gated already, so the caller passes `enabled` to
// keep the query from firing for a principal the API would refuse. Returns the raw query so
// a consumer can branch on pending/error/empty for its own empty-state and loading copy.
export function useLocations({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: async (): Promise<Location[]> => {
      const response = await locationsApi.list()
      return response.locations
    },
    enabled,
  })
}
