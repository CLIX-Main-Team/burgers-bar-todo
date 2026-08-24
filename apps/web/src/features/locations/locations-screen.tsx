import { useSession } from '../../auth/session.js'
import { LocationManagement } from './location-management.js'

// The `/locations` route's screen. Admin-tier, reached from the account menu's "Manage
// locations" entry and gated by RequireAdmin (a manager or employee is bounced to the task
// board). Presentation gating only — the API authorises every /locations request (ADR-0007)
// — so this only supplies the principal from the session, the same way PeopleScreen does,
// and renders the management surface into the shell's Outlet. LocationManagement itself
// reads the principal to tell a super_admin from a branch admin (2026-08-23), since the two
// no longer see the same set of controls.
export function LocationsScreen() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before any shell route renders; narrow the type.
  if (!principal) {
    return null
  }

  return <LocationManagement principal={principal} />
}
