import { buildApp } from './app.js'
import {
  createDisabledEmbeddingClient,
  createHttpEmbeddingClient,
  resolveEmbeddingConfig,
} from './assistant/embedding-client.js'
import { createGoogleDriveClient } from './assistant/google-drive-client.js'
import { listKnowledgeDocs } from './assistant/knowledge-listing.js'
import { createHttpLlmClient, resolveLlmConfig } from './assistant/llm-client.js'
import { BACKSTOP_POLL_INTERVAL_MS } from './assistant/sync-triggers.js'
import {
  createAnswerComponents,
  createAssistantComponents,
  createConversationComponents,
} from './assistant/wire.js'
import { systemClock } from './auth/clock.js'
import { createSmtpMailer } from './auth/smtp-mailer.js'
import { createAuthComponents } from './auth/wire.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'
import { createLocationRepository } from './locations/repository.js'
import { createFcmPushSender } from './notifications/fcm-push-sender.js'
import { createNoopPushSender } from './notifications/push-sender.js'
import { createNotificationComponents } from './notifications/wire.js'
import { createProjectComponents } from './projects/wire.js'
import { createTaskBoardComponents } from './task-board/wire.js'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000
const KEEP_ALIVE_INTERVAL_MS = 10 * MS_PER_MINUTE

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

  // The assistant knowledge sync (ADR-0021): the real fetch-backed Google Drive adapter, over the
  // required credentials env.ts validated at boot, and the reconciliation service + interval trigger
  // it drives. A best-effort per-document failure during the first full load is logged, never fatal.
  const drive = createGoogleDriveClient({
    serviceAccount: env.GOOGLE_SERVICE_ACCOUNT_JSON,
    folderId: env.DRIVE_FOLDER_ID,
  })
  // The one LLM client (ADR-0018), resolved before the assistant components because both the
  // knowledge categorizer (ADR-0024) and the answer path below ride the same port.
  const llm = createHttpLlmClient(resolveLlmConfig(env))
  // The embedding client for the retrieval index (ADR-0025), riding the same provider key. A
  // provider with no embeddings surface (groq) resolves to null and the disabled client — the
  // index stays keyword-ranked, never an error.
  const embeddingConfig = resolveEmbeddingConfig(env)
  const embeddings = embeddingConfig
    ? createHttpEmbeddingClient(embeddingConfig)
    : createDisabledEmbeddingClient()
  const {
    repo: knowledgeRepo,
    syncService,
    syncTriggers,
  } = createAssistantComponents(db, systemClock, drive, {
    sync: {
      onDocumentError: (driveFileId, error) =>
        console.error(`assistant knowledge sync: skipped document ${driveFileId}`, error),
    },
    llm,
    categorizer: {
      onCategoryError: (driveFileId, error) =>
        console.error(`assistant knowledge categorizer: doc ${driveFileId} left unfiled: ${error}`),
    },
    embeddings,
    indexer: {
      onIndexError: (scope, error) =>
        console.error(`assistant knowledge index: ${scope} left pending: ${error}`),
      // The language bridge's gist LLM (chunk-index.ts), gated on live embeddings so a
      // disabled-embeddings boot never spends completions on gists no embedding will use.
      ...(embeddingConfig ? { llm, embeddingModel: embeddingConfig.model } : {}),
    },
  })

  // The task-board surface (#131 Slice A read, #132 Slice A2 live channel, #133 Slice B writes): the
  // scoped board read and its last-seen trigger, the manager/admin write service, and the in-process
  // change bus the SSE fan-out relays, over the same db and system clock. Built before the answer
  // path so its scoped read repository (ADR-0007) is the one the assistant grounds tasks on (#92).
  // Push notifications (#59). The transport is resolved here and nowhere else: with both Firebase
  // settings present the real FCM sender goes in, and with either missing the no-op one does, so a
  // deployment that has no Firebase project yet still runs every other part of the feature —
  // devices register, assignments resolve their recipients, nothing rings. Turning push on is then
  // two environment variables, not a release.
  const pushSender =
    env.FCM_PROJECT_ID && env.FCM_SERVICE_ACCOUNT_JSON
      ? createFcmPushSender({
          projectId: env.FCM_PROJECT_ID,
          serviceAccount: env.FCM_SERVICE_ACCOUNT_JSON,
          onSendError: (message) => console.error(message),
        })
      : createNoopPushSender()
  if (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_JSON) {
    console.warn('push: no Firebase credentials configured — notifications are registered but mute')
  }
  const { repository: pushDeviceRepository, notifier: taskNotifier } = createNotificationComponents(
    db,
    pushSender,
    { onNotifyError: (message) => console.error(message) },
  )

  const {
    repository: taskBoardRepository,
    boardService,
    writeService: taskWriteService,
    events: taskBoardEvents,
  } = createTaskBoardComponents(db, systemClock, taskNotifier)

  // The assistant answer path (#91, #92): resolve the LLM provider at boot (fail fast if the selected
  // provider's key is missing, ADR-0018) and wire the grounded answer service over the knowledge
  // cache, the thread store, and the task-board scoped read (#92 — the same ADR-0007 read path the
  // board uses, never a bespoke task query). Grounding reads the local cache only, so this needs no
  // Drive client — a slow or unprovisioned Drive never touches the answer path (ADR-0004).
  const { answerService } = createAnswerComponents(
    db,
    systemClock,
    llm,
    taskBoardRepository,
    embeddings,
  )

  // The admin locations API (#164, Slice L1): the create/list/rename data-access surface the
  // `/locations` routes sit directly on top of. A single repository over the same db — no service
  // interposes, since the surface is admin-only with no per-principal scope.
  const locationRepository = createLocationRepository(db)
  const { service: projectService } = createProjectComponents(db)

  const app = buildApp({
    // Alongside the deploy-specific SPA origin, always allow the Capacitor wrapper
    // origins — fixed by the WebView shells (https://localhost on Android,
    // capacitor://localhost on iOS), not per-environment, so they live here and not
    // in CORS_ORIGIN. Auth stays safe: it rides the bearer header, not cookies.
    corsOrigin: [env.CORS_ORIGIN, 'https://localhost', 'capacitor://localhost'],
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
    locations: { sessionService, locationRepository },
    projects: { sessionService, projectService },
    devices: { sessionService, pushDevices: pushDeviceRepository },
    // The assistant's manager/admin sync surface: the manual resync and the Knowledge tab's
    // listing (ADR-0024). Registered now that the real Drive adapter is always provisioned
    // (env.ts requires its credentials at boot) — the deferral ADR-0014 carved out is over.
    assistant: {
      sessionService,
      resync: () => syncTriggers.resyncNow(),
      listKnowledgeDocs: () => listKnowledgeDocs(knowledgeRepo),
    },
  })

  // The knowledge-sync interval timer, started once the server is listening (below) and held here so
  // onClose can tear it down before the pool closes, so no tick ever fires against a closing database
  // pool. The hook is registered here, before listen, because Fastify rejects new hooks once the app
  // is ready — a holder object carries the timer the closure needs across that gap.
  const timers: { sync?: NodeJS.Timeout; keepAlive?: NodeJS.Timeout } = {}
  app.addHook('onClose', () => {
    clearInterval(timers.sync)
    clearInterval(timers.keepAlive)
    return pool.end()
  })

  // Prefer the platform-injected PORT (Render, ADR-0017); fall back to API_PORT for
  // local dev. Host 0.0.0.0 so the container's published port is reachable.
  const port = env.PORT ?? env.API_PORT
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${port}`)

  // Kick the knowledge sync now the server is listening (ADR-0021), then keep it current on a
  // ~20-minute cadence. The boot fire is fire-and-forget: on a never-synced knowledge base it runs
  // the full load that fills the already-populated Drive folder; on an already-synced one it is an
  // immediate incremental catch-up for edits made while the server was down. It never blocks or
  // fails the boot — a slow or broken Drive is logged, and the app is already healthy. The interval
  // reuses the single-flight reconcile, so the boot fire and the first tick collapse into one walk.
  syncService.reconcile().catch((error) => {
    console.error('assistant knowledge sync: boot reconcile failed', error)
  })
  timers.sync = setInterval(() => {
    syncTriggers.pollBackstop().catch((error) => {
      console.error('assistant knowledge sync: interval reconcile failed', error)
    })
  }, BACKSTOP_POLL_INTERVAL_MS)

  // Keep the Render free-tier instance awake: ping our own public /health every 10 minutes, under
  // the ~15-minute idle spin-down. The request must go out through the public URL — an in-process
  // call wouldn't count as inbound traffic. Runs only where Render injects RENDER_EXTERNAL_URL, so
  // local dev and any future VPS host skip it. Stopgap for the demo deploy.
  if (env.RENDER_EXTERNAL_URL) {
    const healthUrl = new URL('/health', env.RENDER_EXTERNAL_URL)
    timers.keepAlive = setInterval(() => {
      fetch(healthUrl).catch((error) => {
        console.error('keep-alive ping failed', error)
      })
    }, KEEP_ALIVE_INTERVAL_MS)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
