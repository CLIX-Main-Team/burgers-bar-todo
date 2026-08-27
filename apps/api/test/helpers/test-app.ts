import type { TaskPriority, TaskStatus } from '@burgers/shared'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { createAccessService } from '../../src/access/service.js'
import { buildApp } from '../../src/app.js'
import { createConversationComponents } from '../../src/assistant/wire.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { type CapturingMailer, createCapturingMailer } from '../../src/auth/mailer.js'
import { type AuthComponents, createAuthComponents } from '../../src/auth/wire.js'
import { createDb } from '../../src/db/client.js'
import { taskAssignees, tasks, users } from '../../src/db/schema.js'
import { createLocationRepository } from '../../src/locations/repository.js'
import {
  type CapturingPushSender,
  createCapturingPushSender,
} from '../../src/notifications/push-sender.js'
import { createNotificationComponents } from '../../src/notifications/wire.js'
import { createProjectComponents } from '../../src/projects/wire.js'
import { type TaskBoardComponents, createTaskBoardComponents } from '../../src/task-board/wire.js'
import { type ChecklistScanStub, createChecklistScanStub } from './checklist-scan-stub.js'
import { type TestDb, startTestDb } from './test-db.js'

// What a test asks for when seeding a task directly (Slice A has no create path — that lands in
// Slice B). Everything but the location has a sensible default so a case names only what it asserts
// on; an empty assigneeIds (or omitting it) seeds a backlog task.
export interface SeedTaskInput {
  locationId: string | null
  // Who created the seeded task (#258). Optional: a case that asserts on creators names one, and
  // every other case falls back to the seeded admin — the same "pre-existing history belongs to
  // the admin" rule the column's backfill migration applies.
  createdBy?: string
  // Seed a private task (2026-08-25). It carries no branch, so a case that sets this passes no
  // locationId; the scope predicate is what the case is usually there to exercise.
  personal?: boolean
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: Date | null
  completedAt?: Date | null
  position?: number
  // File the seeded task into a project, for the cases that prove a project's counts and its task
  // list are the same scoped rows.
  projectId?: string | null
  assigneeIds?: string[]
}

export interface TestHarness {
  app: FastifyInstance
  // The injected clock every expiry decision reads; tests advance it to drive the
  // session and token windows deterministically.
  clock: MutableClock
  // The capturing fake mailer: tests read `sent` to assert a mail went out and drive the
  // one-time link inside it back through the API (auth plan, testing approach).
  mailer: CapturingMailer
  // The capturing fake push transport (#59), the mailer's twin for notifications. Everything above
  // it is the real thing — the device rows, the assignee diff, the language grouping — so a case
  // registers a device through the real endpoint, makes a real assignment, and reads `sent` to see
  // exactly which phones would have rung and in which language.
  pushSender: CapturingPushSender
  // The same auth objects the server wires, so a test can seed the first admin
  // in-process through the real seedAdmin path (the seed is the thing under test,
  // not an internal helper the assertions poke at).
  components: AuthComponents
  // Seed a Location row through the real location repository (#130 prefactor), so a case can
  // create a Location and a user bound to it via the FK on users.location_id. Returns the
  // created id and name; an explicit id lets a case pin a known Location it references later.
  seedLocation: (input?: { id?: string; name?: string }) => Promise<{ id: string; name: string }>
  // Seed a task (and its assignee set) straight into the store, so a Slice A read case has tasks
  // to read before any create path exists (that lands in Slice B). Returns the new task id.
  seedTask: (input: SeedTaskInput) => Promise<{ id: string }>
  // Replace a task's assignee set outright (delete-then-insert), standing in for the reassignment
  // the write slices will own. The SSE test (#132) uses it to move a task toward or away from an
  // employee and prove the live channel re-evaluates scope at delivery time.
  setTaskAssignees: (taskId: string, userIds: string[]) => Promise<void>
  // The knowledge-base checklist scan the board route calls (owner ask 2026-08-27), as a stub a
  // case scripts. The scan's own behaviour — retrieval, prompt, parsing — is unit-tested against a
  // fake LLM in checklist-scan.test.ts; what the route owns is the chain-owner gate and the two
  // status codes, so the harness only needs to say what the scan came back with.
  checklistScan: ChecklistScanStub
  // The task-board components (#131/#132), so the SSE test can publish a change onto the same
  // in-process bus the write slices will use — the real fan-out path, not a test-only backdoor.
  taskBoard: TaskBoardComponents
  // Start a real listening socket and return its base URL. The scoped-read cases drive the app
  // in-process via app.inject(); the SSE case (#132) needs an actual server and socket so a real
  // event stream can be opened over HTTP. Idempotent — returns the same URL if already listening.
  listen: () => Promise<string>
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
  // The role-capability and horizon answers, built first so the session's principal carries
  // its role's horizons — the same order the server wires them in, so a case that moves a
  // switch or a horizon observes it on the very next guarded request.
  const accessService = createAccessService(db)

  const components = createAuthComponents(
    db,
    clock,
    mailer,
    {
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
    },
    (role) => accessService.viewScopes(role),
  )

  // The assistant conversation store shares this harness's db and clock (#90), so the thread
  // routes are driven through the same in-process app and the same controllable time source.
  const conversation = createConversationComponents(db, clock)

  // The Location repository (#130 seed/backfill path, #164 the admin locations API). It backs both
  // the harness's seedLocation helper and — since Slice L1 — the wired `/locations` routes, so a
  // case drives create/list/rename through the same in-process app the server runs.
  const locationRepository = createLocationRepository(db)

  // The task-board read surface under test (#131), sharing this harness's db and clock so the
  // scoped read is driven through the same in-process app and the last-seen trigger reads the
  // same controllable time source the tests advance.
  // Notifications (#59) over a capturing transport: the device repository and the task notifier are
  // the production ones, so the diff, the recipient lookup and the message copy are all under test;
  // only the wire out to Firebase is faked, exactly as the mailer fakes only the wire out to SMTP.
  const pushSender = createCapturingPushSender()
  const notifications = createNotificationComponents(db, pushSender)

  const taskBoard = createTaskBoardComponents(db, clock, notifications.notifier)

  const checklistScan = createChecklistScanStub()

  // The projects surface, sharing this harness's db. Its reads reuse the board service above, so a
  // project's task list is the same scoped rows the kanban serves rather than a second query.
  const projects = createProjectComponents(db)

  // The role-capability answers (owner ask 2026-08-24), the same single instance the server
  // wires everywhere — so a case that flips a switch through POST /access/update observes the
  // change on the very next guarded request.

  const app = buildApp({
    auth: {
      sessionService: components.sessionService,
      authService: components.authService,
      inviteService: components.inviteService,
      accountService: components.accountService,
      resetService: components.resetService,
      accessService,
      listUsers: (scope) => components.repo.listUsers(scope),
    },
    threads: {
      sessionService: components.sessionService,
      threadService: conversation.threadService,
      accessService,
    },
    taskBoard: {
      sessionService: components.sessionService,
      boardService: taskBoard.boardService,
      writeService: taskBoard.writeService,
      events: taskBoard.events,
      accessService,
      checklistScanner: checklistScan,
    },
    locations: {
      sessionService: components.sessionService,
      locationRepository,
      accessService,
    },
    devices: {
      sessionService: components.sessionService,
      pushDevices: notifications.repository,
    },
    projects: {
      sessionService: components.sessionService,
      projectService: projects.service,
      accessService,
    },
    access: {
      sessionService: components.sessionService,
      accessService,
    },
  })
  await app.ready()

  let baseUrl: string | undefined

  return {
    app,
    clock,
    mailer,
    pushSender,
    components,
    checklistScan,
    taskBoard,
    listen: async () => {
      if (baseUrl) return baseUrl
      // Ephemeral port on loopback: a real socket for the SSE stream, off any fixed port so
      // parallel runs never collide.
      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      baseUrl = address
      return address
    },
    seedLocation: (input) =>
      locationRepository.createLocation({ name: input?.name ?? 'Test Location', id: input?.id }),
    seedTask: async (input) => {
      // created_by is NOT NULL (#258): a case that names no creator gets the seeded admin, the
      // same attribution the column's backfill gives rows that predate it. Matches either admin
      // role (2026-08-23): the seed account is a super_admin now that admin narrowed to a branch,
      // so a literal 'admin' filter would find no row at all. Resolved per seed, not cached —
      // reset() truncates users between cases, so a cached id would go stale.
      let createdBy = input.createdBy
      if (!createdBy) {
        const [adminRow] = await db
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.role, ['admin', 'super_admin']))
          .orderBy(asc(users.createdAt))
          .limit(1)
        if (!adminRow) {
          throw new Error('seedTask: no admin to attribute the task to — seed one first')
        }
        createdBy = adminRow.id
      }
      const inserted = await db
        .insert(tasks)
        .values({
          locationId: input.locationId,
          personal: input.personal ?? false,
          createdBy,
          title: input.title ?? 'Task',
          description: input.description ?? null,
          // status/priority/position fall through to the column defaults when a case omits them.
          status: input.status,
          priority: input.priority,
          dueDate: input.dueDate ?? null,
          completedAt: input.completedAt ?? null,
          projectId: input.projectId ?? null,
          position: input.position,
        })
        .returning({ id: tasks.id })
      const row = inserted[0]
      if (!row) throw new Error('seedTask: insert returned no row')
      const assigneeIds = input.assigneeIds ?? []
      if (assigneeIds.length > 0) {
        await db
          .insert(taskAssignees)
          .values(assigneeIds.map((userId) => ({ taskId: row.id, userId })))
      }
      return row
    },
    setTaskAssignees: async (taskId, userIds) => {
      await db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId))
      if (userIds.length > 0) {
        await db.insert(taskAssignees).values(userIds.map((userId) => ({ taskId, userId })))
      }
    },
    reset: async () => {
      // auth_tokens, threads, and messages all cascade from users, and users from locations, but
      // name them so the intent is explicit and no state leaks between cases. locations is
      // truncated too so a seeded Location never carries into the next test. The task-board tables
      // (tasks, task_assignees, task_board_last_seen) are named for the same reason — a seeded task,
      // its assignee rows, or a bumped last-seen marker must not carry into the next case. So is
      // push_devices (#59): a device registered by one case must not be rung by the next.
      await db.execute(
        sql`truncate table sessions, auth_tokens, messages, threads, tasks, task_assignees, task_board_last_seen, push_devices, users, locations, role_capabilities cascade`,
      )
      // The clock is harness state too: rewind it so a test that advanced it (the
      // sliding-window cases) cannot leak a shifted "now" into the next test.
      clock.set(clockStart)
      // Drop any captured mail so a test only ever sees its own outbound messages.
      mailer.clear()
      // Same for captured push (#59) — every write in the suite that assigns somebody produces
      // one, so without this a case would see the previous case's notifications.
      pushSender.clear()
      // And the scripted checklist scan: a scan outcome one case set, or a title it recorded,
      // must not stand for the next.
      checklistScan.reset()
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
