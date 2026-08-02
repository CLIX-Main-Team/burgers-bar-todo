import { Navigate } from 'react-router-dom'
import { useSession } from '../auth/session.js'

// A minimal full-screen wait while the current-principal read settles on load. Kept
// text-only and untranslated deliberately — it flashes for a moment before either the
// app or login renders, and has no user decision on it.
function FullScreenLoader() {
  return <div className="flex min-h-dvh items-center justify-center text-sm text-slate-400">…</div>
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
