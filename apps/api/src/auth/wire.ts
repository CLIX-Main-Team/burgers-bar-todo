import type { Db } from '../db/client.js'
import { type AuthService, createAuthService } from './auth-service.js'
import type { Clock } from './clock.js'
import { type Argon2Cost, type PasswordHasher, createPasswordHasher } from './password.js'
import { type AuthRepository, createAuthRepository } from './repository.js'
import { type SessionService, createSessionService } from './sessions.js'

export interface AuthConfig {
  // The sliding idle window in days (SESSION_TTL_DAYS; ADR-0006/0010).
  sessionTtlDays: number
  // argon2id cost overrides; omitted in prod (library defaults), lowered in tests.
  argon2Cost?: Argon2Cost
}

// The single composition point for the auth module, so the running server, the seed
// CLI, and the integration-test harness wire the same objects the same way. The db
// and clock are injected (a real pool + systemClock in prod; the test Postgres + a
// mutable clock under test), which is the whole substitution surface the plan names.
export interface AuthComponents {
  repo: AuthRepository
  hasher: PasswordHasher
  sessionService: SessionService
  authService: AuthService
}

export function createAuthComponents(db: Db, clock: Clock, config: AuthConfig): AuthComponents {
  const repo = createAuthRepository(db)
  const hasher = createPasswordHasher(config.argon2Cost)
  const sessionService = createSessionService(repo, clock, { ttlDays: config.sessionTtlDays })
  const authService = createAuthService(repo, hasher, sessionService)
  return { repo, hasher, sessionService, authService }
}
