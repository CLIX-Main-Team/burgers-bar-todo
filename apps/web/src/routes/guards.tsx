import type { CapabilityKey } from '@burgers/shared'
import { Navigate } from 'react-router-dom'
import { canManageLocations, canProvision, hasCapability } from '../auth/roles.js'
import { useSession } from '../auth/session.js'
import { firstDestination } from '../shell/destinations.js'

// A minimal full-screen wait while the current-principal read settles on load. Kept
// text-only and untranslated deliberately — it flashes for a moment before either the
// app or login renders, and has no user decision on it.
function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-body text-muted-foreground">
      …
    </div>
  )
}

// In-app routes require a live session. While the principal read is in flight we wait;
// an unauthenticated visitor is sent to login (ui-flow, routing). Because the principal
// is read fresh, a session revoked out from under the user resolves here on the next
// navigation and bounces them to login.
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  if (status === 'loading') {
    return <FullScreenLoader />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}

// The capability guard (owner ask 2026-08-24): a screen renders only for a role holding its
// page capability, and everyone else is sent to the first page their role does hold rather
// than shown a screen whose calls would 403. UI convenience only — the API authorises every
// request independently through the same capability service (ADR-0007), so this guard is not
// the security boundary. It renders inside RequireAuth (the shell's layout route), so by
// here a principal is present; the null check only narrows the type while that parent
// settles.
export function RequireCapability({
  capability,
  children,
}: {
  capability: CapabilityKey
  children: React.ReactNode
}) {
  const { principal } = useSession()
  if (principal && !hasCapability(principal, capability)) {
    return <Navigate to={firstDestination(principal)} replace />
  }
  return <>{children}</>
}

// The provisioning surface (`/people`): whoever holds the Users page. Kept as a named guard
// because the account menu reads the same canProvision predicate.
export function RequireProvisioner({ children }: { children: React.ReactNode }) {
  const { principal } = useSession()
  if (principal && !canProvision(principal)) {
    return <Navigate to={firstDestination(principal)} replace />
  }
  return <>{children}</>
}

// The locations surface (`/locations`): whoever holds the Locations page.
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { principal } = useSession()
  if (principal && !canManageLocations(principal)) {
    return <Navigate to={firstDestination(principal)} replace />
  }
  return <>{children}</>
}

// Where "/" lands: the first destination this principal's capabilities allow (the Access
// page as the backstop when a role holds no pages at all).
export function LandingRedirect() {
  const { principal } = useSession()
  if (!principal) {
    return null
  }
  return <Navigate to={firstDestination(principal)} replace />
}

// The pre-auth screens that represent "get me signed in" (login, reset-request) send an
// already-authenticated user into the app instead (ui-flow, routing). Token-bearing
// one-time flows (accept, reset-consume) are deliberately left ungated so their link
// still opens.
export function RequireAnon({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  if (status === 'loading') {
    return <FullScreenLoader />
  }
  if (status === 'authenticated') {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
