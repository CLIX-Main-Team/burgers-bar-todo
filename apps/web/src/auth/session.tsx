import type { PrincipalResponse } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiError, authApi } from '../lib/api.js'
import { queryClient } from '../lib/query-client.js'
import { clearStoredToken, getStoredToken, setStoredToken } from '../lib/token-storage.js'

// The session is the SPA's answer to "who is signed in, right now". It rests on the
// persisted bearer (token-storage) and the current-principal read (/auth/me), which the
// API resolves fresh on every request (ADR-0007) — so a deactivation or a role change
// takes effect on the next fetch with no re-login. The provider is the one place that
// stores the token on a successful sign-in and clears it on logout.

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface SessionContextValue {
  status: SessionStatus
  principal: PrincipalResponse | null
  // Called after accept or sign-in returns a bearer: persist it and enter the app.
  signIn(token: string): Promise<void>
  // Log out this device (ui-flow, story 24): end the current session, then drop the
  // local bearer and return to login.
  signOut(): Promise<void>
  // Log out of all devices (ui-flow, story 25): end every session for this user.
  signOutAll(): Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

const ME_QUERY_KEY = ['auth', 'me'] as const

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Token in state mirrors the persisted value; it exists only to drive re-renders and
  // to gate the me query. token-storage remains the source of truth the API client reads.
  const [token, setToken] = useState<string | null>(() => getStoredToken())

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: authApi.me,
    enabled: token !== null,
  })

  // A stored token the API rejects (expired, revoked, deactivated) is no session at all:
  // clear it so the app settles on "unauthenticated" and the user lands on login.
  const rejected = meQuery.error instanceof ApiError && meQuery.error.status === 401
  useEffect(() => {
    if (rejected && token !== null) {
      clearStoredToken()
      setToken(null)
    }
  }, [rejected, token])

  const signIn = useCallback(async (nextToken: string) => {
    setStoredToken(nextToken)
    setToken(nextToken)
    // Pull the fresh principal for the new session before the app renders behind the guard.
    await queryClient.refetchQueries({ queryKey: ME_QUERY_KEY })
  }, [])

  const clearLocal = useCallback(() => {
    clearStoredToken()
    setToken(null)
    // Drop all cached server state so nothing from the old session bleeds into the next.
    queryClient.clear()
  }, [])

  const signOut = useCallback(async () => {
    // Best-effort: even if the call fails (already-revoked token, offline), the local
    // session is cleared so the device returns to login regardless.
    try {
      await authApi.logout()
    } catch {
      // ignore — clearing locally is what returns the user to login
    }
    clearLocal()
  }, [clearLocal])

  const signOutAll = useCallback(async () => {
    try {
      await authApi.logoutAll()
    } catch {
      // ignore — same best-effort contract as signOut
    }
    clearLocal()
  }, [clearLocal])

  const status: SessionStatus =
    token === null || rejected
      ? 'unauthenticated'
      : meQuery.data
        ? 'authenticated'
        : meQuery.isError
          ? 'unauthenticated'
          : 'loading'

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      principal: meQuery.data ?? null,
      signIn,
      signOut,
      signOutAll,
    }),
    [status, meQuery.data, signIn, signOut, signOutAll],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return ctx
}
