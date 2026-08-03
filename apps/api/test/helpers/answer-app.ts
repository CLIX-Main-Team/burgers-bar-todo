import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import { type FakeLlmClient, createFakeLlmClient } from '../../src/assistant/llm-client.js'
import {
  type AssistantComponents,
  createAnswerComponents,
  createAssistantComponents,
  createConversationComponents,
} from '../../src/assistant/wire.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type CapturingMailer, createCapturingMailer } from '../../src/auth/mailer.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { createLocationRepository } from '../../src/locations/repository.js'
import { type TestDb, startTestDb } from './test-db.js'

// The integration seam for the grounded answer path (#91): the full app — auth, the thread routes
// with the answer path wired, and the assistant resync route — built in-process over a fresh
// migrated Postgres and driven via app.inject() with no network. The answer path's LLM caller is
// the scriptable fake (createFakeLlmClient), so the answer, the retry-on-failure, the budget, and
// the guardrail wiring are all driven through the injection seam with no real provider traffic. The
// knowledge corpus is scripted through the fake Drive and made live by hitting POST /assistant/resync
// exactly as a procedure author would, so grounding is exercised end-to-end. Every substitution is
// an injected fake — clock, mailer, Drive, LLM — and every assertion is external-behaviour-only:
// HTTP status/body, and state seen through a follow-up request.

export interface AnswerAppHarness {
  app: FastifyInstance
  // The auth objects the app wires, exposed so a test can seed the first admin in-process through
  // the real seedAdmin path (as the other harnesses do).
  auth: AuthComponents
  // The current assistant sync components — the resync trigger the route awaits and the repository
  // the follow-up reads go through. Rebuilt on reset() so each test gets a fresh single-flight latch.
  readonly assistant: AssistantComponents
  // The scriptable fake Drive: a test scripts the procedure corpus through it (putDoc/removeFile),
  // then calls POST /assistant/resync to mirror it into the knowledge cache.
  drive: FakeDriveClient
  // The scriptable fake LLM: a test scripts a canned answer, a grounding-reflecting responder, or a
  // forced failure, and reads the captured requests to assert the budget and the replayed-turn count.
  llm: FakeLlmClient
  // The injected clock; assistant and conversation writes stamp their timestamps from it.
  clock: MutableClock
  // The capturing fake mailer, so a test can invite-and-accept the users it needs.
  mailer: CapturingMailer
  // Seed a Location through the real location repository (#130), so a case can invite a user
  // bound to it via the FK on users.location_id. Returns the created id and name.
  seedLocation: (input?: { id?: string; name?: string }) => Promise<{ id: string; name: string }>
  reset: () => Promise<void>
  close: () => Promise<void>
}

export async function createAnswerAppHarness(): Promise<AnswerAppHarness> {
  const testDb = await startTestDb()
  const { db, pool } = createDb(testDb.connectionString)

  const clockStart = new Date('2026-01-01T00:00:00.000Z')
  const clock = createMutableClock(clockStart)
  const mailer = createCapturingMailer()
  const drive = createFakeDriveClient()
  const llm = createFakeLlmClient()

  // The assistant sync components live behind a mutable holder so reset() can rebuild them — a fresh
  // single-flight latch per test — while the resync route closure, which reads through the holder,
  // keeps pointing at the current instance.
  const buildAssistant = (): AssistantComponents => createAssistantComponents(db, clock, drive)
  let assistant = buildAssistant()

  const auth = createAuthComponents(db, clock, mailer, {
    sessionTtlDays: 14,
    inviteTtlMs: 168 * 60 * 60 * 1000,
    resetTtlMs: 60 * 60 * 1000,
    appBaseUrl: 'http://localhost:5173',
    resetRateLimit: { perEmail: 100, perIp: 100, windowMs: 60 * 60 * 1000 },
    // argon2id cost lowered for test speed — a timing change, not a behaviour change.
    argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
  })

  // The real seed path for a Location (#130), so a case creates one through code rather than a raw
  // INSERT before inviting a user bound to it.
  const locationRepository = createLocationRepository(db)

  // The conversation store (#90) and the answer path (#91) share this db and clock; the answer path
  // also takes the fake LLM as its injected port.
  const { threadService } = createConversationComponents(db, clock)
  const { answerService } = createAnswerComponents(db, clock, llm)

  const app = buildApp({
    auth: {
      sessionService: auth.sessionService,
      authService: auth.authService,
      inviteService: auth.inviteService,
      accountService: auth.accountService,
      resetService: auth.resetService,
      listUsers: (scope) => auth.repo.listUsers(scope),
    },
    threads: {
      sessionService: auth.sessionService,
      threadService,
      answerService,
    },
    assistant: {
      sessionService: auth.sessionService,
      // Awaited in the handler, so a just-scripted doc is answerable by the time the caller sees the
      // acknowledgement — the same contract the running server's manual resync honours (#89).
      resync: () => assistant.syncTriggers.resyncNow(),
    },
  })
  await app.ready()

  return {
    app,
    auth,
    get assistant() {
      return assistant
    },
    drive,
    llm,
    clock,
    mailer,
    seedLocation: (input) =>
      locationRepository.createLocation({ name: input?.name ?? 'Test Location', id: input?.id }),
    reset: async () => {
      await db.execute(
        sql`truncate table sessions, auth_tokens, messages, threads, users, locations, knowledge_docs, drive_sync_state cascade`,
      )
      clock.set(clockStart)
      assistant = buildAssistant()
      mailer.clear()
      auth.resetRateLimiter.clear()
      drive.reset()
      llm.reset()
    },
    close: async () => {
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
