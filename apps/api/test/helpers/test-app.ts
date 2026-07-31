import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { type TestDb, startTestDb } from './test-db.js'

export interface TestHarness {
  app: FastifyInstance
  db: TestDb
  close: () => Promise<void>
}

// The integration seam every later auth slice reuses: a fresh migrated Postgres,
// the Fastify app built in-process, and driven via app.inject() — no network,
// no listening socket. Tests assert on external behaviour only (status + body),
// never by reading rows or calling internal helpers (auth plan, testing approach).
export async function createTestHarness(): Promise<TestHarness> {
  const db = await startTestDb()
  const app = buildApp()
  await app.ready()
  return {
    app,
    db,
    close: async () => {
      await app.close()
      await db.stop()
    },
  }
}
