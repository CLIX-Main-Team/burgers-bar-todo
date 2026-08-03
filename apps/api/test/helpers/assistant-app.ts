import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import { type AssistantComponents, createAssistantComponents } from '../../src/assistant/wire.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type CapturingMailer, createCapturingMailer } from '../../src/auth/mailer.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { type TestDb, startTestDb } from './test-db.js'

// The integration seam for the assistant sync-trigger slice (#89): the full app — auth routes and
// the assistant resync route — built in-process over a fresh migrated Postgres, driven via
// app.inject() with no network. The three triggers are wired exactly as the running server would
// wire them: the sign-in route fires the login trigger fire-and-forget, the resync endpoint awaits
// the manual trigger, and the backstop tick is driven directly off the mutable clock. The only
// substitutions are the injected clock, the capturing mailer, and the scriptable fake Drive; every
// assertion is external-behaviour-only — HTTP status/body and cache state seen through a follow-up
// read, and the fake Drive's call counts — never a raw row select.

export interface AssistantAppHarness {
  app: FastifyInstance
  // The auth objects the app wires, exposed so a test can seed the first admin in-process through
  // the real seedAdmin path (as the auth harness does).
  auth: AuthComponents
  // The current assistant components — the repository the follow-up reads go through, the sync
  // service, and the three triggers. Recreated on reset() so each test gets a fresh single-flight
  // latch and a fresh backstop window.
  readonly assistant: AssistantComponents
  // The scriptable fake Drive: a test scripts the corpus through it (putDoc/removeFile), models an
  // unreliable Drive (failNextListChanges/holdNextListChanges), and reads its call counts.
  drive: FakeDriveClient
  // The injected clock; assistant writes stamp their timestamps from it and the backstop poll
  // measures its interval against it.
  clock: MutableClock
  // The capturing fake mailer, so a test can invite-and-accept the manager and employee it needs
  // to prove the resync endpoint's role enforcement.
  mailer: CapturingMailer
  // The errors the login fire-and-forget trigger swallowed and reported — the proof a failing
  // Drive was isolated from the login path rather than surfaced on it.
  syncErrors: unknown[]
  // Wipe auth and cache state and rebuild the assistant components between tests, so cases do not
  // leak into one another.
  reset: () => Promise<void>
  close: () => Promise<void>
}

export async function createAssistantAppHarness(): Promise<AssistantAppHarness> {
  const testDb = await startTestDb()
  const { db, pool } = createDb(testDb.connectionString)

  const clockStart = new Date('2026-01-01T00:00:00.000Z')
  const clock = createMutableClock(clockStart)
  const mailer = createCapturingMailer()
  const drive = createFakeDriveClient()
  const syncErrors: unknown[] = []

  // Build the assistant components with the login trigger's errors routed to syncErrors, so a
  // rebuild on reset() reproduces the exact wiring.
  const buildAssistant = (): AssistantComponents =>
    createAssistantComponents(db, clock, drive, { onError: (error) => syncErrors.push(error) })

  // The assistant components live behind a mutable holder so reset() can rebuild them — a fresh
  // single-flight latch and backstop window per test — while the app's trigger closures, which
  // read through the holder, keep pointing at the current instance.
  let assistant = buildAssistant()

  // Drain any fire-and-forget login sync a prior test left in flight, coalescing onto an in-flight
  // pass rather than starting a rogue one, so a background reconcile never races a truncate or the
  // pool closing under it.
  const drainInFlightSync = () => assistant.syncService.reconcile().catch(() => {})

  const auth = createAuthComponents(db, clock, mailer, {
    sessionTtlDays: 14,
    inviteTtlMs: 168 * 60 * 60 * 1000,
    resetTtlMs: 60 * 60 * 1000,
    appBaseUrl: 'http://localhost:5173',
    resetRateLimit: { perEmail: 100, perIp: 100, windowMs: 60 * 60 * 1000 },
    // argon2id cost lowered for test speed — a timing change, not a behaviour change.
    argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
  })

  const app = buildApp({
    auth: {
      sessionService: auth.sessionService,
      authService: auth.authService,
      inviteService: auth.inviteService,
      accountService: auth.accountService,
      resetService: auth.resetService,
      listUsers: (scope) => auth.repo.listUsers(scope),
      // Fire-and-forget login sync, wired as the running server would (ADR-0014).
      onSignIn: () => assistant.syncTriggers.onLogin(),
    },
    assistant: {
      sessionService: auth.sessionService,
      resync: () => assistant.syncTriggers.resyncNow(),
    },
  })

  return {
    app,
    auth,
    get assistant() {
      return assistant
    },
    drive,
    clock,
    mailer,
    syncErrors,
    reset: async () => {
      // Drain any in-flight login sync before wiping its tables, so a background reconcile never
      // races the truncate.
      await drainInFlightSync()
      await db.execute(
        sql`truncate table sessions, auth_tokens, users, knowledge_docs, drive_sync_state cascade`,
      )
      // Rewind the clock first, then rebuild the assistant components so the backstop window is
      // seeded at the restored start — no prior test's advanced clock leaks into the next.
      clock.set(clockStart)
      assistant = buildAssistant()
      mailer.clear()
      auth.resetRateLimiter.clear()
      drive.reset()
      syncErrors.length = 0
    },
    close: async () => {
      // Let any last in-flight login sync settle before the pool closes under it.
      await drainInFlightSync()
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
