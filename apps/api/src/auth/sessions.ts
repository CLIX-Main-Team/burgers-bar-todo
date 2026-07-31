import type { Clock } from './clock.js'
import type { Principal } from './principal.js'
import type { AuthRepository } from './repository.js'
import { generateSessionToken, hashSessionToken } from './session-token.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SessionServiceConfig {
  // The sliding idle window, in days (SESSION_TTL_DAYS; ADR-0006, value in ADR-0010).
  ttlDays: number
}

// The session service (ADR-0006): issue an opaque bearer for a user, and validate a
// presented bearer against its row, extending the sliding idle window on each use.
// It owns the whole credential lifecycle except revocation, which logout/logout-all
// add in a later slice (#30). Time comes only from the injected clock, so every
// expiry case is deterministic in tests.
export interface SessionService {
  issue(userId: string): Promise<string>
  validate(rawToken: string): Promise<Principal | undefined>
}

export function createSessionService(
  repo: AuthRepository,
  clock: Clock,
  config: SessionServiceConfig,
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

      return {
        userId: session.userId,
        role: session.role,
        locationId: session.locationId,
        status: session.status,
      }
    },
  }
}
