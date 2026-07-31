import type { PasswordHasher } from './password.js'
import type { AuthRepository } from './repository.js'
import type { SessionService } from './sessions.js'

// A fixed sentinel no one signs in with, hashed once through the configured hasher to
// give sign-in a decoy to verify against when there is no real credential (see below).
const DUMMY_PASSWORD_SENTINEL = 'burgers-bar-nonexistent-credential'

export interface AuthService {
  // Returns a fresh bearer token on success, or undefined for every bad-credential
  // case — unknown email, wrong password, or a non-active account — so the route
  // answers all of them with one generic failure that reveals nothing (story 18).
  signIn(email: string, password: string): Promise<string | undefined>
}

export function createAuthService(
  repo: AuthRepository,
  hasher: PasswordHasher,
  sessions: SessionService,
): AuthService {
  // Hash the sentinel lazily, once, through the same hasher real passwords use — so
  // the decoy always carries the exact argon2 cost the real hashes do, even if that
  // cost is later retuned. A miss (unknown email, or a user with no password) verifies
  // against it so the response time does not betray which branch we took, closing the
  // timing side channel behind the identical failure response (story 18).
  let dummyHash: Promise<string> | undefined
  const getDummyHash = (): Promise<string> => {
    dummyHash ??= hasher.hash(DUMMY_PASSWORD_SENTINEL)
    return dummyHash
  }

  return {
    signIn: async (email, password) => {
      const user = await repo.findUserByEmail(email)

      // Only an active user with a set password can sign in. Invited users have no
      // password_hash yet; deactivated users are blocked (ADR-0005, ADR-0006).
      const candidateHash = user && user.status === 'active' ? user.passwordHash : null
      const passwordOk = await hasher.verify(candidateHash ?? (await getDummyHash()), password)

      if (!user || !candidateHash || !passwordOk) return undefined

      return sessions.issue(user.id)
    },
  }
}
