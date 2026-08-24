import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createAccessService } from '../../src/access/service.js'
import { buildApp } from '../../src/app.js'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import {
  type FakeEmbeddingClient,
  createFakeEmbeddingClient,
} from '../../src/assistant/embedding-client.js'
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
import { createNoopPushSender } from '../../src/notifications/push-sender.js'
import { createNotificationComponents } from '../../src/notifications/wire.js'
import type { CreateTaskInput, TaskRow } from '../../src/task-board/repository.js'
import { createTaskBoardComponents } from '../../src/task-board/wire.js'
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
  // The scriptable fake embeddings (ADR-0025). Unscripted it fails, which is the deliberate
  // posture: retrieval then ranks chunks by keywords — a deterministic function of the seeded
  // text — so grounding cases stay stable without inventing vector geometry.
  embeddings: FakeEmbeddingClient
  // The injected clock; assistant and conversation writes stamp their timestamps from it.
  clock: MutableClock
  // The capturing fake mailer, so a test can invite-and-accept the users it needs.
  mailer: CapturingMailer
  // Seed a Location through the real location repository (#130), so a case can invite a user
  // bound to it via the FK on users.location_id. Returns the created id and name.
  seedLocation: (input?: { id?: string; name?: string }) => Promise<{ id: string; name: string }>
  // Seed a task through the same task-board data-access the board writes go through (#92 tests): a
  // case scripts the board a role should or should not see, then asks the assistant about it. The
  // location is passed explicitly and assignees are ids, so a case can place a task in another
  // location or assign it to another user to prove the scope boundary holds.
  seedTask: (input: Omit<CreateTaskInput, 'createdBy'> & { createdBy?: string }) => Promise<TaskRow>
  // Resolve a provisioned user's id from their email (through the real admin-scoped list read), so a
  // case can assign a seeded task to the employee it just invited without threading ids through the
  // HTTP provisioning helpers.
  userIdByEmail: (email: string) => Promise<string>
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
  const embeddings = createFakeEmbeddingClient()

  // The assistant sync components live behind a mutable holder so reset() can rebuild them — a fresh
  // single-flight latch per test — while the resync route closure, which reads through the holder,
  // keeps pointing at the current instance. The fake embeddings ride along so the resync path
  // chunks (and, if a test scripts vectors, embeds) exactly as the server's sync does.
  const buildAssistant = (): AssistantComponents =>
    createAssistantComponents(db, clock, drive, { embeddings })
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

  // The task-board components (#131 Slice A): the answer path (#92) grounds task questions on the
  // same ADR-0007-scoped repository read the board uses, so the harness wires the real repository and
  // hands it to the answer path — the identical composition the running server does.
  // The answer harness never writes a task, so its notifier is wired over a no-op transport — the
  // real notifier, but with nothing behind it to ring (#59).
  const taskBoard = createTaskBoardComponents(
    db,
    clock,
    createNotificationComponents(db, createNoopPushSender()).notifier,
  )

  // The conversation store (#90) and the answer path (#91, #92) share this db and clock; the answer
  // path also takes the fake LLM as its injected port and the scoped board read for task grounding.
  const { threadService } = createConversationComponents(db, clock)
  const { answerService } = createAnswerComponents(db, clock, llm, taskBoard.repository, embeddings)

  const accessService = createAccessService(db)

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
    threads: {
      sessionService: auth.sessionService,
      threadService,
      answerService,
      accessService,
    },
    assistant: {
      sessionService: auth.sessionService,
      // Awaited in the handler, so a just-scripted doc is answerable by the time the caller sees the
      // acknowledgement — the same contract the running server's manual resync honours (#89).
      resync: () => assistant.syncTriggers.resyncNow(),
      accessService,
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
    embeddings,
    clock,
    mailer,
    seedLocation: (input) =>
      locationRepository.createLocation({ name: input?.name ?? 'Test Location', id: input?.id }),
    seedTask: async (input) => {
      // created_by is NOT NULL (#258): a grounding case that names no creator gets the seeded
      // admin, the same attribution the column's backfill gives rows that predate it. The scope
      // must be super_admin (2026-08-23): admin narrowed to a branch, so only the chain-wide role
      // still reads every row unscoped — a literal 'admin' scope now finds nothing.
      let createdBy = input.createdBy
      if (!createdBy) {
        const all = await auth.repo.listUsers({ role: 'super_admin', locationId: null })
        const admin = all.find((row) => row.role === 'admin' || row.role === 'super_admin')
        if (!admin) {
          throw new Error('seedTask: no admin to attribute the task to — seed one first')
        }
        createdBy = admin.id
      }
      return taskBoard.repository.createTask({ ...input, createdBy })
    },
    userIdByEmail: async (email) => {
      // Read through the real super_admin-scoped list (every user), then resolve by email — the
      // same read the provisioning UI uses, never a raw peek. Provisioned emails are unique, so at
      // most one hit. Only super_admin reads unscoped (2026-08-23, admin narrowed to a branch).
      const all = await auth.repo.listUsers({ role: 'super_admin', locationId: null })
      const user = all.find((row) => row.email === email)
      if (!user) throw new Error(`userIdByEmail: no user for ${email}`)
      return user.id
    },
    reset: async () => {
      await db.execute(
        sql`truncate table sessions, auth_tokens, messages, threads, tasks, task_assignees, task_board_last_seen, users, locations, knowledge_docs, knowledge_chunks, drive_sync_state cascade`,
      )
      clock.set(clockStart)
      assistant = buildAssistant()
      mailer.clear()
      auth.resetRateLimiter.clear()
      drive.reset()
      llm.reset()
      embeddings.reset()
    },
    close: async () => {
      await app.close()
      await pool.end()
      await testDb.stop()
    },
  }
}
