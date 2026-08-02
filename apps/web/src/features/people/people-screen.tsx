import { useSession } from '../../auth/session.js'
import { PeopleManagement } from './people-management.js'

// The `/people` route's screen. The shell relocates the provisioning surface out of the
// old app-shell content area onto its own address (PRD, stories 17/19), but its
// internals and the endpoints it calls are unchanged — this only supplies the principal
// from the session and renders PeopleManagement into the shell's Outlet.
//
// This is presentation gating's convenience side only; the API still authorises every
// request (ADR-0007), so reaching `/people` without provisioning rights simply yields
// an empty/forbidden surface rather than a privilege.
export function PeopleScreen() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before any shell route renders; narrow the type.
  if (!principal) {
    return null
  }

  return <PeopleManagement principal={principal} />
}
