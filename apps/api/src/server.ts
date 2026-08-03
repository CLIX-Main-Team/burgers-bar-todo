import { buildApp } from './app.js'
import { createHttpLlmClient, resolveLlmConfig } from './assistant/llm-client.js'
import { createAnswerComponents, createConversationComponents } from './assistant/wire.js'
import { systemClock } from './auth/clock.js'
import { createSmtpMailer } from './auth/smtp-mailer.js'
import { createAuthComponents } from './auth/wire.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'
import { createTaskBoardComponents } from './task-board/wire.js'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

// Process entry point: build the app and listen. The factory (buildApp) is kept
// separate so tests drive the app in-process without a socket.
async function main(): Promise<void> {
  loadRootEnv()
  const env = loadEnv()

  // Real dependencies for the running server: a Postgres pool, the system clock, the
  // argon2id defaults, and the SMTP mailer. Tests substitute the clock and mailer (see
  // the integration harness).
  const { db, pool } = createDb(env.DATABASE_URL)
  const mailer = createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from: env.MAIL_FROM,
  })
  const { sessionService, authService, inviteService, accountService, resetService, repo } =
    createAuthComponents(db, systemClock, mailer, {
      sessionTtlDays: env.SESSION_TTL_DAYS,
      inviteTtlMs: env.INVITE_TTL_HOURS * MS_PER_HOUR,
      resetTtlMs: env.RESET_TTL_HOURS * MS_PER_HOUR,
      appBaseUrl: env.APP_BASE_URL,
      resetRateLimit: {
        perEmail: env.RESET_RATE_LIMIT_PER_EMAIL,
        perIp: env.RESET_RATE_LIMIT_PER_IP,
        windowMs: env.RESET_RATE_LIMIT_WINDOW_MINUTES * MS_PER_MINUTE,
      },
    })

  // The assistant conversation store (#90): threads depend only on the db and clock, so they
  // are served without a provisioned Drive client (deferred, ADR-0014).
  const { threadService } = createConversationComponents(db, systemClock)

  // The task-board surface (#131 Slice A read, #132 Slice A2 live channel, #133 Slice B writes): the
  // scoped board read and its last-seen trigger, the manager/admin write service, and the in-process
  // change bus the SSE fan-out relays, over the same db and system clock. Built before the answer
  // path so its scoped read repository (ADR-0007) is the one the assistant grounds tasks on (#92).
  const {
    repository: taskBoardRepository,
    boardService,
    writeService: taskWriteService,
    events: taskBoardEvents,
  } = createTaskBoardComponents(db, systemClock)

  // The assistant answer path (#91, #92): resolve the LLM provider at boot (fail fast if the selected
  // provider's key is missing, ADR-0018) and wire the grounded answer service over the knowledge
  // cache, the thread store, and the task-board scoped read (#92 — the same ADR-0007 read path the
  // board uses, never a bespoke task query). Grounding reads the local cache only, so this needs no
  // Drive client — a slow or unprovisioned Drive never touches the answer path (ADR-0004).
  const llm = createHttpLlmClient(resolveLlmConfig(env))
  const { answerService } = createAnswerComponents(db, systemClock, llm, taskBoardRepository)

  const app = buildApp({
    corsOrigin: env.CORS_ORIGIN,
    auth: {
      sessionService,
      authService,
      inviteService,
      accountService,
      resetService,
      listUsers: (scope) => repo.listUsers(scope),
    },
    threads: { sessionService, threadService, answerService },
    taskBoard: {
      sessionService,
      boardService,
      writeService: taskWriteService,
      events: taskBoardEvents,
    },
  })
  app.addHook('onClose', () => pool.end())

  // Prefer the platform-injected PORT (Render, ADR-0017); fall back to API_PORT for
  // local dev. Host 0.0.0.0 so the container's published port is reachable.
  const port = env.PORT ?? env.API_PORT
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${port}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
