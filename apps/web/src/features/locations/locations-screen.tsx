import { isSuperAdmin } from '@burgers/shared'
import { Navigate } from 'react-router-dom'
import { useSession } from '../../auth/session.js'
import { LocationManagement } from './location-management.js'

// The `/locations` route's screen. Reached from the rail and gated on page.locations (an
// employee is bounced to their board). Presentation gating only — the API authorises every
// /locations request (ADR-0007) — so this supplies the principal from the session, the same way
// PeopleScreen does, and renders into the shell's Outlet.
//
// Since 2026-08-25 it also skips the list for anyone who holds exactly one branch. A chain list
// of one row, whose only affordance is to open the row, is two clicks to reach the only page they
// could have been going to (the owner's words: "when clicking location it should show their own
// stats rather than doing 2 clicks"). The list stays for the super_admin, who has a chain to
// compare. `replace` so Back leaves the section rather than bouncing off the redirect.
export function LocationsScreen() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before any shell route renders; narrow the type.
  if (!principal) {
    return null
  }

  if (!isSuperAdmin(principal.role) && principal.locationId) {
    return <Navigate to={`/locations/${principal.locationId}`} replace />
  }

  return <LocationManagement principal={principal} />
}
