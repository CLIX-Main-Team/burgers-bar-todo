import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createAccessService } from '../../src/access/service.js'
import { buildApp } from '../../src/app.js'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import { listKnowledgeDocs } from '../../src/assistant/knowledge-listing.js'
import { type FakeLlmClient, createFakeLlmClient } from '../../src/assistant/llm-client.js'
import { type AssistantComponents, createAssistantComponents } from '../../src/assistant/wire.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type CapturingMailer, createCapturingMailer } from '../../src/auth/mailer.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { createLocationRepository } from '../../src/locations/repository.js'
import { type TestDb, startTestDb } from './test-db.js'

// The integration seam for the assistant sync triggers (#89, ADR-0021): the full app — auth routes
// and the assistant resync route — built in-process over a fresh migrated Postgres, driven via
// app.inject() with no network. The triggers are wired exactly as the running server would wire
// them: the resync endpoint awaits the manual trigger, and the interval tick is driven directly off
// the mutable clock. Login no longer touches Drive (ADR-0021 reverses ADR-0014's login trigger).
// The only substitutions are the injected clock, the capturing mailer, and the scriptable fake
// Drive; every assertion is external-behaviour-only — HTTP status/body and cache state seen through
// a follow-up read, and the fake Drive's call counts — never a raw row select.

export interface AssistantAppHarness {
  app: FastifyInstance
  // The auth objects the app wires, exposed so a test can seed the first admin in-process through
  // the real seedAdmin path (as the auth harness does).
  auth: AuthComponents
  // The current assistant components — the repository the follow-up reads go through, the sync
  // service, and the triggers. Recreated on reset() so each test gets a fresh single-flight latch
  // and a fresh interval window.
  readonly assistant: AssistantComponents
  // The scriptable fake Drive: a test scripts the corpus through it (putDoc/removeFile), models an
  // unreliable Drive (failNextListChanges/holdNextListChanges), and reads its call counts.
  drive: FakeDriveClient
  // The injected clock; assistant writes stamp their timestamps from it and the interval poll
  // measures its interval against it.
  clock: MutableClock
  // The scriptable fake LLM the knowledge categorizer files docs with (ADR-0024).
  llm: FakeLlmClient
  // The capturing fake mailer, so a test can invite-and-accept the manager and employee it needs
  // to prove the resync endpoint's role enforcement.
  mailer: CapturingMailer
  // Seed a Location through the real location repository (#130), so a case can invite the
  // manager/employee it needs bound to it via the FK on users.location_id.
  seedLocation: (input?: { id?: string; name?: string }) => Promise<{ id: string; name: string }>
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
  const llm: FakeLlmClient = createFakeLlmClient()
  // Unless a test scripts otherwise, the categorizer's fake files everything under the
  // `general` floor — a recognizable slug, so default runs behave like an obedient model.
  llm.setDefaultAnswer('general')

  // Build the assistant components; a rebuild on reset() reproduces the exact wiring.
  const buildAssistant = (): AssistantComponents =>
    createAssistantComponents(db, clock, drive, { llm })

  // The assistant components live behind a mutable holder so reset() can rebuild them — a fresh
  // single-flight latch and interval window per test — while the app's trigger closures, which
  // read through the holder, keep pointing at the current instance.
  let assistant = buildAssistant()

  // Drain any sync a prior test left in flight, coalescing onto an in-flight pass rather than
  // starting a rogue one, so a background reconcile never races a truncate or the pool closing
  // under it.
  const drainInFlightSync = () => assistant.syncService.reconcile().catch(() => {})

  // The role-capability and horizon answers, built first so the session's principal carries
  // its role's horizons — the same order the server wires them in, so a case that moves a
  // switch or a horizon observes it on the very next guarded request.
  const accessService = createAccessService(db)

  const auth = createAuthComponents(
    db,
    clock,
    mailer,
    {
      sessionTtlDays: 14,
      inviteTtlMs: 168 * 60 * 60 * 1000,
      resetTtlMs: 60 * 60 * 1000,
      appBaseUrl: 'http://localhost:5173',
      resetRateLimit: { perEmail: 100, perIp: 100, windowMs: 60 * 60 * 1000 },
      // argon2id cost lowered for test speed — a timing change, not a behaviour change.
      argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
    },
    (role) => accessService.viewScopes(role),
  )

  // The real seed path for a Location (#130), so a case creates one through code before inviting a
  // user bound to it.
  const locationRepository = createLocationRepository(db)

  const app = buildApp({
    auth: {
      sessionService: auth.sessionService,
      authService: auth.authService,
      inviteService: auth.inviteService,
      accountService: auth.accountService,
      resetService: auth.resetService,
      accessService,
      listUsers: (scope) => auth.repo.listUsers(scope),
    },
    assistant: {
      sessionService: auth.sessionService,
      resync: () => assistant.syncTriggers.resyncNow(),
      listKnowledgeDocs: (scope) => listKnowledgeDocs(assistant.repo, scope),
      accessService,
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
    llm,
    mailer,
    seedLocation: (input) =>
      locationRepository.createLocation({ name: input?.name ?? 'Test Location', id: input?.id }),
    reset: async () => {
      // Drain any in-flight sync before wiping its tables, so a background reconcile never races
      // the truncate.
      await drainInFlightSync()
      await db.execute(
        sql`truncate table sessions, auth_tokens, users, locations, knowledge_docs, knowledge_chunks, drive_sync_state cascade`,
      )
      // Rewind the clock first, then rebuild the assistant components so the interval window is
      // seeded at the restored start — no prior test's advanced clock leaks into the next.
      clock.set(clockStart)
      assistant = buildAssistant()
      mailer.clear()
      auth.resetRateLimiter.clear()
      drive.reset()
      llm.reset()
      llm.setDefaultAnswer('general')
    },
    close: async () => {
      // Let any last in-flight sync settle before the pool closes under it.
      await drainInFlightSync()
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
