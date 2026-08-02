import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type CapturingMailer, createCapturingMailer } from '../../src/auth/mailer.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { type TestDb, startTestDb } from './test-db.js'

export interface TestHarness {
  app: FastifyInstance
  // The injected clock every expiry decision reads; tests advance it to drive the
  // session and token windows deterministically.
  clock: MutableClock
  // The capturing fake mailer: tests read `sent` to assert a mail went out and drive the
  // one-time link inside it back through the API (auth plan, testing approach).
  mailer: CapturingMailer
  // The same auth objects the server wires, so a test can seed the first admin
  // in-process through the real seedAdmin path (the seed is the thing under test,
  // not an internal helper the assertions poke at).
  components: AuthComponents
  // Wipe auth state between tests so cases do not leak into one another.
  reset: () => Promise<void>
  close: () => Promise<void>
}

// The integration seam every auth slice reuses (auth plan, testing approach): a fresh
// migrated Postgres, a mutable clock, and an argon2id cost lowered for speed — a
// timing change, not a behaviour change — all injected into the app built in-process
// and driven via app.inject(). Tests assert on external behaviour only (status, body,
// and state seen through a follow-up request), never by reading rows directly.
export async function createTestHarness(): Promise<TestHarness> {
  const testDb = await startTestDb()
  const { db, pool } = createDb(testDb.connectionString)

  const clockStart = new Date('2026-01-01T00:00:00.000Z')
  const clock = createMutableClock(clockStart)
  const mailer = createCapturingMailer()
  const components = createAuthComponents(db, clock, mailer, {
    sessionTtlDays: 14,
    // ~1 week, matching INVITE_TTL_HOURS (168h); expiry cases drive the clock.
    inviteTtlMs: 168 * 60 * 60 * 1000,
    // ~1 hour, matching RESET_TTL_HOURS; the reset-expiry case drives the clock past it.
    resetTtlMs: 60 * 60 * 1000,
    appBaseUrl: 'http://localhost:5173',
    // Small limits over a one-hour window so the rate-limit cases trip in a handful of
    // requests. The per-email and per-IP cases isolate one limiter by varying the other
    // key per request (a fresh IP, or a fresh email), so each proves its own limit.
    resetRateLimit: { perEmail: 3, perIp: 3, windowMs: 60 * 60 * 1000 },
    argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
  })

  const app = buildApp({
    auth: {
      sessionService: components.sessionService,
      authService: components.authService,
      inviteService: components.inviteService,
      accountService: components.accountService,
      resetService: components.resetService,
      listUsers: (scope) => components.repo.listUsers(scope),
    },
  })
  await app.ready()

  return {
    app,
    clock,
    mailer,
    components,
    reset: async () => {
      // auth_tokens cascades from users, but name it so the intent is explicit.
      await db.execute(sql`truncate table sessions, auth_tokens, users cascade`)
      // The clock is harness state too: rewind it so a test that advanced it (the
      // sliding-window cases) cannot leak a shifted "now" into the next test.
      clock.set(clockStart)
      // Drop any captured mail so a test only ever sees its own outbound messages.
      mailer.clear()
      // Clear the in-process reset rate-limit windows so one test's requests do not carry
      // their counts into the next (the limiter is harness state, like the clock).
      components.resetRateLimiter.clear()
    },
    close: async () => {
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
