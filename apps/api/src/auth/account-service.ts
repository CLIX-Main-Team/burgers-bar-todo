import type { Clock } from './clock.js'
import type { AccountActionScope, AuthRepository, UserRow } from './repository.js'
import type { SessionService } from './sessions.js'

// The account-status service (#33, ADR-0005, ADR-0006): an admin cuts a user's access
// immediately while retaining their record, and restores it later. Deactivate is a
// status flip plus an all-session revocation; reactivate is the reverse status flip.
// The route resolves the tier-one guard (super_admin or admin, ADR-0007) and derives the
// AccountActionScope from the principal; this service passes it straight through to the
// repository, which bakes it into the query's WHERE (accountActionScopePredicate) so an
// out-of-remit id resolves nothing rather than being filtered out after the fact.
//
// Deactivation immediacy rests on two mechanisms that agree: the sessions are revoked
// outright (a row delete, so the next request finds no session), and the per-request
// principal is read fresh from the users row (ADR-0007), so even a session that somehow
// survived would be refused on the deactivated status. Reactivate relies on the
// repository's status guard: only a previously-active — therefore password-bearing —
// account is restored, so sign-in works with no re-provisioning (story 32).

export interface AccountService {
  // Deactivate a user by id, within scope: flip active -> deactivated and revoke every
  // session they hold. Returns the deactivated user, or undefined when nothing matched —
  // unknown id, already deactivated/invited, or outside the caller's scope — so the route
  // answers all three alike with a not-found.
  deactivate(userId: string, scope: AccountActionScope): Promise<UserRow | undefined>
  // Reactivate a user by id, within scope: flip deactivated -> active. Returns the
  // reactivated user, or undefined when nothing matched, so the route answers with a
  // not-found.
  reactivate(userId: string, scope: AccountActionScope): Promise<UserRow | undefined>
  // Move a person to another branch (owner ask 2026-08-27). Scope-free on purpose: the route
  // admits only super_admin, whose reach is the chain, so there is no tier-two remit to carry.
  // Sessions are left alone — the per-request principal picks the move up by itself.
  assign(userId: string, locationId: string): Promise<UserRow | undefined>
}

export function createAccountService(
  repo: AuthRepository,
  sessions: SessionService,
  clock: Clock,
): AccountService {
  return {
    deactivate: async (userId, scope) => {
      const user = await repo.deactivateUser(userId, scope, clock.now())
      if (!user) return undefined

      // Cut every session the user holds the moment access is revoked — the same
      // all-session revocation a completed reset uses (story 31). Ordered after the
      // status flip so nothing is revoked for a user who was not actually deactivated.
      await sessions.revokeAllForUser(userId)

      return user
    },

    reactivate: async (userId, scope) => {
      return repo.reactivateUser(userId, scope, clock.now())
    },

    assign: async (userId, locationId) => {
      return repo.assignUserLocation(userId, locationId, clock.now())
    },
  }
}
