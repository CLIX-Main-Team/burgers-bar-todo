import { isChainAdmin } from '@burgers/shared'
import { Navigate } from 'react-router-dom'
import { canProvision } from '../auth/roles.js'
import { useSession } from '../auth/session.js'

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

// The provisioning surface (`/people`) is for admins and managers; an employee who
// navigates there directly is sent to the task board rather than shown a screen whose
// calls would 403 (Ticket 2). This is a UI convenience only — the API authorises every
// /people request independently (ADR-0007), so this guard is not the security boundary.
// It renders inside RequireAuth (the shell's layout route), so by here a principal is
// present; the null check only narrows the type while that parent settles.
export function RequireProvisioner({ children }: { children: React.ReactNode }) {
  const { principal } = useSession()
  if (principal && !canProvision(principal)) {
    return <Navigate to="/tasks" replace />
  }
  return <>{children}</>
}

// The locations surface (`/locations`) is Admin-only — narrower than `/people`, which
// managers also reach (#165). A manager or employee who navigates here directly is sent
// to the task board rather than shown a screen whose calls would 403. Like
// RequireProvisioner this is a UI convenience only: the API authorises every /locations
// request independently (ADR-0007), so this guard is not the security boundary. It renders
// inside RequireAuth, so a principal is present by here; the null check only narrows the
// type while that parent settles.
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { principal } = useSession()
  if (principal && !isChainAdmin(principal.role)) {
    return <Navigate to="/tasks" replace />
  }
  return <>{children}</>
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
