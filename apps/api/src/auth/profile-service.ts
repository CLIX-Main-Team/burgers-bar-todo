import type { UpdateProfileRequest } from '@burgers/shared'
import type { Clock } from './clock.js'
import type { PasswordHasher } from './password.js'
import type { AuthRepository, UserRow } from './repository.js'
import type { SessionService } from './sessions.js'

// A person's edits to their own account from the Profile page (owner ask 2026-09-04): name,
// disc colour, password. Every method takes the user id from the resolved principal, so the
// only row this service can ever touch is the caller's own — there is no target id to check a
// scope against, which is why it is not on AccountService (whose every method is an admin
// acting on somebody else under an AccountActionScope).

export type ChangePasswordOutcome = 'ok' | 'wrong_password' | 'not_active'

export interface ProfileService {
  // Apply a partial edit and return the fresh row, or undefined when the caller is no longer
  // an active user (validate() already refuses that session; this is the belt to its braces).
  updateProfile(userId: string, patch: UpdateProfileRequest): Promise<UserRow | undefined>
  // Verify the current password, store the new one, and cut every OTHER session this person
  // holds — a password change is the one thing a person does when they suspect a walked-away
  // login, and the device they are typing on is the one they trust. The calling session is
  // kept by token so the page does not log its own user out.
  changePassword(input: {
    userId: string
    sessionToken: string
    currentPassword: string
    newPassword: string
  }): Promise<ChangePasswordOutcome>
}

export function createProfileService(
  repo: AuthRepository,
  hasher: PasswordHasher,
  sessions: SessionService,
  clock: Clock,
): ProfileService {
  return {
    updateProfile: (userId, patch) =>
      repo.updateOwnProfile({
        userId,
        displayName: patch.displayName,
        avatarTone: patch.avatarTone,
        now: clock.now(),
      }),

    changePassword: async ({ userId, sessionToken, currentPassword, newPassword }) => {
      const storedHash = await repo.findActiveUserPasswordHash(userId)
      if (!storedHash) return 'not_active'
      if (!(await hasher.verify(storedHash, currentPassword))) return 'wrong_password'

      const now = clock.now()
      const passwordHash = await hasher.hash(newPassword)
      const user = await repo.setActiveUserPassword({ userId, passwordHash, now })
      if (!user) return 'not_active'

      // Spend any outstanding reset link too: a reset mailed before the change would otherwise
      // still set a password the person has just replaced on purpose.
      await repo.invalidateResetTokens(userId, now)
      await sessions.revokeOthersForUser(userId, sessionToken)
      return 'ok'
    },
  }
}
