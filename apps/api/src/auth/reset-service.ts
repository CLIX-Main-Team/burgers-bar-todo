import type { Clock } from './clock.js'
import type { Mailer } from './mailer.js'
import type { PasswordHasher } from './password.js'
import type { ResetRateLimiter } from './rate-limiter.js'
import type { AuthRepository } from './repository.js'
import type { SessionService } from './sessions.js'
import type { TokenService } from './tokens.js'

// The password-reset service (#34, ADR-0005, ADR-0006): self-service recovery that leaks
// nothing about which emails exist and cuts every compromised session the moment the
// account is recovered. It reuses the shared token primitive (reset purpose) and the same
// mailer port the invite slice uses.
//
// Two operations:
//
// - request: return one generic acknowledgement whatever the email is (story 27) and
//   whether or not the request was throttled (story 30). Only an active user actually gets
//   a reset token minted and a link mailed; an unknown, invited, or deactivated address
//   gets the same on-screen response and no mail and no usable token. Requesting a fresh
//   reset invalidates the user's prior reset links (story 28).
//
// - consume: validate the single-use token, refuse a too-short password (enforced upstream
//   by the schema), set the new password, invalidate the user's other outstanding reset
//   tokens, and revoke all of the user's sessions (story 29). No session is issued — the
//   user is sent to login to sign in afresh (ui-flow, reset consume).

export interface ResetServiceConfig {
  // The reset token lifetime (RESET_TTL_HOURS; ~1 hour, ADR-0006/0010).
  resetTtlMs: number
  // Public base URL the app is reached at, used to build the one-time reset link.
  appBaseUrl: string
}

export interface RequestResetInput {
  email: string
  // The requester's IP, resolved from the connection at the route; the per-IP half of the
  // rate limit (story 30). Never a client-supplied body field.
  ip: string
}

export interface ResetService {
  // Always resolves — the caller returns one generic acknowledgement regardless. Any real
  // effect (mint token, send mail) happens only for an active, non-throttled email; every
  // other case is a silent no-op so the response reveals nothing (stories 27, 30, 33).
  requestReset(input: RequestResetInput): Promise<void>
  // Returns true when the reset completed, or false for every failure — an unknown,
  // expired, or already-used token, or a token resolving to a non-active user — so the
  // route answers all of them with one generic rejection that leaks nothing.
  consumeReset(token: string, newPassword: string): Promise<boolean>
}

export function createResetService(
  repo: AuthRepository,
  tokens: TokenService,
  mailer: Mailer,
  hasher: PasswordHasher,
  sessions: SessionService,
  rateLimiter: ResetRateLimiter,
  clock: Clock,
  config: ResetServiceConfig,
): ResetService {
  return {
    requestReset: async ({ email, ip }) => {
      // Rate-limit first, and count every request against both windows before anything
      // else, so throttling is uniform and never depends on whether the email matched
      // (story 30). A throttled request stops here — no token, no mail — and the route
      // still returns the generic confirmation, so the throttle leaks no signal.
      if (!rateLimiter.allow(email, ip)) return

      const user = await repo.findUserByEmail(email)
      // Only an active user triggers a real reset (stories 27, 33): an unknown email, a
      // still-invited user, or a deactivated one gets no token and no mail — just the same
      // generic response the caller returns either way, so no usable token is ever produced
      // for them (TC-RESET-04).
      if (!user || user.status !== 'active') return

      // A fresh request supersedes any prior reset link (story 28): invalidate the user's
      // outstanding reset tokens before minting the new one, so there is never a window
      // with two live reset links and the earlier one fails at consume (TC-RESET-11).
      const now = clock.now()
      await repo.invalidateResetTokens(user.id, now)

      // Mint the single-use reset token and carry its raw value in the link exactly once —
      // it is never stored, only its hash is (ADR-0006). Short-lived (~1h) so it is
      // low-risk if it leaks (story 28).
      const rawToken = await tokens.issue(user.id, 'reset', config.resetTtlMs)
      const link = `${config.appBaseUrl}/reset?token=${rawToken}`
      await mailer.send({
        // The address the requester typed, which matched this user case-insensitively — the
        // same mailbox as the stored email, so no need to widen the auth primitive to read
        // it back.
        to: email,
        subject: 'Reset your Burgers Bar password',
        text: `We received a request to reset your Burgers Bar password. Open this link to choose a new one:\n\n${link}\n\nThis link expires in about an hour. If you did not request a reset, you can ignore this email.`,
      })
    },

    consumeReset: async (token, newPassword) => {
      // Spend the token first (atomic single-use): an unknown, expired, or already-used
      // token stops here with nothing touched, so a second consume of the same token fails
      // (TC-RESET-07) and an expired one is refused (TC-RESET-08).
      const userId = await tokens.consume(token, 'reset')
      if (!userId) return false

      const now = clock.now()
      const passwordHash = await hasher.hash(newPassword)
      const user = await repo.setActiveUserPassword({ userId, passwordHash, now })
      // The token resolved to a user who is no longer active (deactivated after the request,
      // say): the password is not changed and no sessions are revoked, so a stale reset
      // token can never quietly act on a cut-off account.
      if (!user) return false

      // Invalidate the user's other outstanding reset tokens, then cut every session they
      // hold — a compromised session is severed the instant the account is recovered
      // (story 29, TC-RESET-10). No new session is issued; the user signs in afresh.
      await repo.invalidateResetTokens(user.id, now)
      await sessions.revokeAllForUser(user.id)
      return true
    },
  }
}
