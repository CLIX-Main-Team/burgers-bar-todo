import type { Role, ViewScopes } from '@burgers/shared'
import type { Clock } from './clock.js'
import type { Principal } from './principal.js'
import type { AuthRepository } from './repository.js'
import { generateSessionToken, hashSessionToken } from './session-token.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// How stale users.last_seen_at must be before an authenticated request restamps it. The
// People roster reports presence in minutes ("Online", "5 min ago"), so a minute of lag is
// invisible there, and the guard keeps the hottest path in the API from writing the users
// table on every single request (repository.touchUserLastSeen).
const LAST_SEEN_STALE_AFTER_MS = 60 * 1000

export interface SessionServiceConfig {
  // The sliding idle window, in days (SESSION_TTL_DAYS; ADR-0006, value in ADR-0010).
  ttlDays: number
}

// How far the caller's role sees, read fresh alongside the session (owner ask 2026-08-26).
// Injected rather than imported so this module keeps knowing only about sessions: the access
// service owns the table, this owns the principal. Omitted — as the session unit tests do —
// the principal simply carries no horizons and every predicate falls back to the role
// defaults, which is the behaviour that shipped before the setting existed.
export type ViewScopeResolver = (role: Role) => Promise<ViewScopes>

// The session service (ADR-0006): issue an opaque bearer for a user, validate a
// presented bearer against its row while extending the sliding idle window on each
// use, and revoke — one session (logout) or every session a user holds (logout-all,
// and the side effect of a completed reset or a deactivation). Revocation is a row
// delete and is immediate. Time comes only from the injected clock, so every expiry
// case is deterministic in tests.
export interface SessionService {
  issue(userId: string): Promise<string>
  validate(rawToken: string): Promise<Principal | undefined>
  revoke(rawToken: string): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
}

export function createSessionService(
  repo: AuthRepository,
  clock: Clock,
  config: SessionServiceConfig,
  resolveViewScopes?: ViewScopeResolver,
): SessionService {
  const ttlMs = config.ttlDays * MS_PER_DAY

  return {
    // Mint a fresh random token, store only its hash, and return the raw value — the
    // one time it exists outside the client. Expiry is now plus the full idle window.
    issue: async (userId) => {
      const now = clock.now()
      const rawToken = generateSessionToken()
      await repo.createSession({
        userId,
        tokenHash: hashSessionToken(rawToken),
        expiresAt: new Date(now.getTime() + ttlMs),
        now,
      })
      return rawToken
    },

    // Resolve a bearer to its principal, or undefined for every failure mode — no row,
    // expired, or a user who is not active — so the caller answers all of them with one
    // generic 401 and leaks nothing. On success the idle window slides forward from now,
    // which is what keeps floor staff signed in across shifts (story 22). Invited and
    // deactivated users do not authenticate (ADR-0006), enforced here on the fresh status.
    validate: async (rawToken) => {
      const now = clock.now()
      const session = await repo.findSessionByTokenHash(hashSessionToken(rawToken))
      if (!session) return undefined
      if (session.expiresAt.getTime() <= now.getTime()) return undefined
      if (session.status !== 'active') return undefined

      await repo.touchSession(session.sessionId, new Date(now.getTime() + ttlMs), now)
      // Presence, for the People roster: this is the one path every authenticated request
      // already passes through, so using it means presence needs no heartbeat endpoint and
      // no client polling of its own — a person is "seen" exactly when they use the app.
      await repo.touchUserLastSeen(session.userId, now, LAST_SEEN_STALE_AFTER_MS)

      return {
        userId: session.userId,
        displayName: session.displayName,
        role: session.role,
        locationId: session.locationId,
        status: session.status,
        viewScopes: await resolveViewScopes?.(session.role),
      }
    },

    // Logout: end this device's session by deleting the row behind the presented
    // token. Hashing the raw value is the only way to reach the row — the raw token
    // is never stored — and a token matching no row is a no-op with the same result.
    revoke: async (rawToken) => {
      await repo.deleteSessionByTokenHash(hashSessionToken(rawToken))
    },

    // Logout-all: cut every session the user holds at once. The caller supplies the
    // user id from the already-resolved principal, never from client input.
    revokeAllForUser: async (userId) => {
      await repo.deleteAllSessionsForUser(userId)
    },
  }
}
