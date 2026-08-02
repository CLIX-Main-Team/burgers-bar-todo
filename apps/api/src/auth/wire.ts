import type { Db } from '../db/client.js'
import { type AuthService, createAuthService } from './auth-service.js'
import type { Clock } from './clock.js'
import { type InviteService, createInviteService } from './invite-service.js'
import type { Mailer } from './mailer.js'
import { type Argon2Cost, type PasswordHasher, createPasswordHasher } from './password.js'
import { type AuthRepository, createAuthRepository } from './repository.js'
import { type SessionService, createSessionService } from './sessions.js'
import { type TokenService, createTokenService } from './tokens.js'

export interface AuthConfig {
  // The sliding idle window in days (SESSION_TTL_DAYS; ADR-0006/0010).
  sessionTtlDays: number
  // The invite token lifetime in milliseconds (~1 week; INVITE_TTL_HOURS, ADR-0006/0010).
  inviteTtlMs: number
  // Public base URL used to build the one-time invite accept link (ADR-0008).
  appBaseUrl: string
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
  mailer: Mailer
}

export function createAuthComponents(
  db: Db,
  clock: Clock,
  mailer: Mailer,
  config: AuthConfig,
): AuthComponents {
  const repo = createAuthRepository(db)
  const hasher = createPasswordHasher(config.argon2Cost)
  const sessionService = createSessionService(repo, clock, { ttlDays: config.sessionTtlDays })
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
  return { repo, hasher, sessionService, authService, tokenService, inviteService, mailer }
}
