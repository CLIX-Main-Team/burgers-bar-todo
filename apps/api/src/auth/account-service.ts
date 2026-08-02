import type { Clock } from './clock.js'
import type { AuthRepository, UserRow } from './repository.js'
import type { SessionService } from './sessions.js'

// The account-status service (#33, ADR-0005, ADR-0006): an admin cuts a user's access
// immediately while retaining their record, and restores it later. Deactivate is a
// status flip plus an all-session revocation; reactivate is the reverse status flip.
// The route has already enforced admin-only at the tier-one guard (ADR-0007); this
// service only carries out the operation and reports whether a matching user was found.
//
// Deactivation immediacy rests on two mechanisms that agree: the sessions are revoked
// outright (a row delete, so the next request finds no session), and the per-request
// principal is read fresh from the users row (ADR-0007), so even a session that somehow
// survived would be refused on the deactivated status. Reactivate relies on the
// repository's status guard: only a previously-active — therefore password-bearing —
// account is restored, so sign-in works with no re-provisioning (story 32).

export interface AccountService {
  // Deactivate a user by id: flip active -> deactivated and revoke every session they
  // hold. Returns the deactivated user, or undefined when no active user matched (unknown
  // id, or already deactivated/invited) so the route answers with a not-found.
  deactivate(userId: string): Promise<UserRow | undefined>
  // Reactivate a user by id: flip deactivated -> active. Returns the reactivated user, or
  // undefined when no deactivated user matched, so the route answers with a not-found.
  reactivate(userId: string): Promise<UserRow | undefined>
}

export function createAccountService(
  repo: AuthRepository,
  sessions: SessionService,
  clock: Clock,
): AccountService {
  return {
    deactivate: async (userId) => {
      const user = await repo.deactivateUser(userId, clock.now())
      if (!user) return undefined

      // Cut every session the user holds the moment access is revoked — the same
      // all-session revocation a completed reset uses (story 31). Ordered after the
      // status flip so nothing is revoked for a user who was not actually deactivated.
      await sessions.revokeAllForUser(userId)

      return user
    },

    reactivate: async (userId) => {
      return repo.reactivateUser(userId, clock.now())
    },
  }
}
