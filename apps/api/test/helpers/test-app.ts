import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { type TestDb, startTestDb } from './test-db.js'

export interface TestHarness {
  app: FastifyInstance
  // The injected clock every expiry decision reads; tests advance it to drive the
  // session window deterministically.
  clock: MutableClock
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

  const clock = createMutableClock(new Date('2026-01-01T00:00:00.000Z'))
  const components = createAuthComponents(db, clock, {
    sessionTtlDays: 14,
    argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
  })

  const app = buildApp({
    auth: {
      sessionService: components.sessionService,
      authService: components.authService,
    },
  })
  await app.ready()

  return {
    app,
    clock,
    components,
    reset: async () => {
      await db.execute(sql`truncate table sessions, users cascade`)
    },
    close: async () => {
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
