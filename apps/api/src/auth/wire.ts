import type { Db } from '../db/client.js'
import { type AccountService, createAccountService } from './account-service.js'
import { type AuthService, createAuthService } from './auth-service.js'
import type { Clock } from './clock.js'
import { type InviteService, createInviteService } from './invite-service.js'
import type { Mailer } from './mailer.js'
import { type Argon2Cost, type PasswordHasher, createPasswordHasher } from './password.js'
import { type ResetRateLimiter, createResetRateLimiter } from './rate-limiter.js'
import { type AuthRepository, createAuthRepository } from './repository.js'
import { type ResetService, createResetService } from './reset-service.js'
import { type SessionService, type ViewScopeResolver, createSessionService } from './sessions.js'
import { type TokenService, createTokenService } from './tokens.js'

export interface AuthConfig {
  // The sliding idle window in days (SESSION_TTL_DAYS; ADR-0006/0010).
  sessionTtlDays: number
  // The invite token lifetime in milliseconds (~1 week; INVITE_TTL_HOURS, ADR-0006/0010).
  inviteTtlMs: number
  // The reset token lifetime in milliseconds (~1 hour; RESET_TTL_HOURS, ADR-0006/0010).
  resetTtlMs: number
  // Public base URL used to build the one-time invite and reset links (ADR-0008).
  appBaseUrl: string
  // Reset-request rate limits (story 30): per-email and per-IP caps over one window.
  resetRateLimit: { perEmail: number; perIp: number; windowMs: number }
  // argon2id cost overrides; omitted in prod (library defaults), lowered in tests.
  argon2Cost?: Argon2Cost
}

// The single composition point for the auth module, so the running server, the seed
// CLI, and the integration-test harness wire the same objects the same way. The db,
// clock, and mailer are injected (a real pool + systemClock + SMTP mailer in prod; the
// test Postgres + a mutable clock + the capturing fake under test) — the whole
// substitution surface the plan names.
export interface AuthComponents {
  repo: AuthRepository
  hasher: PasswordHasher
  sessionService: SessionService
  authService: AuthService
  tokenService: TokenService
  inviteService: InviteService
  accountService: AccountService
  resetService: ResetService
  // Exposed so the test harness can clear the in-process rate-limit windows between cases;
  // the running server never touches it (the windows expire on their own).
  resetRateLimiter: ResetRateLimiter
  mailer: Mailer
}

export function createAuthComponents(
  db: Db,
  clock: Clock,
  mailer: Mailer,
  config: AuthConfig,
  // How far each role sees, for the principal every request resolves (owner ask 2026-08-26).
  // Passed in rather than built here so the access service stays a single shared instance:
  // the guards and the Access page's own switches must read the same one.
  resolveViewScopes?: ViewScopeResolver,
): AuthComponents {
  const repo = createAuthRepository(db)
  const hasher = createPasswordHasher(config.argon2Cost)
  const sessionService = createSessionService(
    repo,
    clock,
    { ttlDays: config.sessionTtlDays },
    resolveViewScopes,
  )
  const authService = createAuthService(repo, hasher, sessionService)
  const tokenService = createTokenService(repo, clock)
  const inviteService = createInviteService(
    repo,
    tokenService,
    mailer,
    hasher,
    sessionService,
    clock,
    { inviteTtlMs: config.inviteTtlMs, appBaseUrl: config.appBaseUrl },
  )
  const accountService = createAccountService(repo, sessionService, clock)
  const resetRateLimiter = createResetRateLimiter(clock, {
    perEmail: config.resetRateLimit.perEmail,
    perIp: config.resetRateLimit.perIp,
    windowMs: config.resetRateLimit.windowMs,
  })
  const resetService = createResetService(
    repo,
    tokenService,
    mailer,
    hasher,
    sessionService,
    resetRateLimiter,
    clock,
    { resetTtlMs: config.resetTtlMs, appBaseUrl: config.appBaseUrl },
  )
  return {
    repo,
    hasher,
    sessionService,
    authService,
    tokenService,
    inviteService,
    accountService,
    resetService,
    resetRateLimiter,
    mailer,
  }
}
