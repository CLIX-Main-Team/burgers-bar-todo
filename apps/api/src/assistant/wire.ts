import type { Clock } from '../auth/clock.js'
import {
  type RateLimiter,
  type RateLimiterConfig,
  createRateLimiter,
} from '../auth/rate-limiter.js'
import type { Db } from '../db/client.js'
import type { OpsNotifier } from '../notifications/ops-notifier.js'
import { createAnswerLog } from './answer-log.js'
import { type AnswerService, createAnswerService } from './answer-service.js'
import { type ChunkIndexerOptions, createChunkIndexer } from './chunk-index.js'
import type { CompanyWebsiteReader } from './company-website.js'
import type { DriveClient } from './drive-client.js'
import { type EmbeddingClient, createDisabledEmbeddingClient } from './embedding-client.js'
import {
  type KnowledgeSyncOptions,
  type KnowledgeSyncService,
  createKnowledgeSyncService,
} from './knowledge-sync.js'
import type { LlmClient, LlmTool } from './llm-client.js'
import { type KnowledgeRepository, createKnowledgeRepository } from './repository.js'
import { createSpendAlert, spendAlertCopy } from './spend-alert.js'
import { type SyncTriggers, type SyncTriggersOptions, createSyncTriggers } from './sync-triggers.js'
import { type ThreadRepository, createThreadRepository } from './thread-repository.js'
import { type ThreadService, createThreadService } from './thread-service.js'
import type { AssistantToolPorts } from './tools.js'
import { createVisualTranscriber } from './visual-transcriber.js'
import { createWhatsappSummaryReader } from './whatsapp-summaries.js'

// The single composition point for the assistant module, mirroring auth/wire.ts, so the
// running server and the integration-test harness wire the same objects the same way. The db,
// clock, and Drive client are injected — a real pool + systemClock + the fetch-backed Google Drive
// adapter in prod (createGoogleDriveClient, ADR-0021); the test Postgres + a mutable clock + the
// scriptable fake under test. The reconciliation service and the interval trigger are composed here
// over the one pass, so every caller shares its single-flight latch.

export interface AssistantComponents {
  repo: KnowledgeRepository
  syncService: KnowledgeSyncService
  // The sync triggers (ADR-0021): the interval tick the server's timer drives (pollBackstop) and
  // the manual resync the deferred endpoint awaits (resyncNow), wired over syncService above.
  syncTriggers: SyncTriggers
}

export interface AssistantComponentsOptions {
  // Best-effort per-document error reporting for the first full load (ADR-0021): the running server
  // passes a logger, the integration harness a collector. Defaults to a no-op.
  sync?: KnowledgeSyncOptions
  // Interval-trigger overrides; defaults keep the real ~20-minute cadence.
  triggers?: SyncTriggersOptions
  // The LLM the visual transcriber reads diagram-only documents with — the same port the answer
  // path calls, injected so the harness scripts a fake. When absent, the sync still runs and
  // diagram documents simply stay flagged.
  llm?: LlmClient
  // The embedding call the retrieval index backfills vectors with (ADR-0025), injected like the
  // LLM. When absent (an embedding-less provider, or a harness that wants deterministic keyword
  // retrieval), docs are still chunked after every sync — chunking is pure — and the vectors
  // simply stay pending.
  embeddings?: EmbeddingClient
  // Index-failure reporting, mirroring the other two: a logger in the server, a collector in tests.
  indexer?: ChunkIndexerOptions
  // Per-screenshot description-failure reporting for the visual transcriber (2026-09 phase 2) —
  // chart-level failures surface through sync.onDocumentError instead, beside the flagged row.
  transcriber?: { onError?: (message: string) => void }
}

export function createAssistantComponents(
  db: Db,
  clock: Clock,
  drive: DriveClient,
  options: AssistantComponentsOptions = {},
): AssistantComponents {
  const repo = createKnowledgeRepository(db)
  // The chunk indexer rides the sync's afterReconcile seam so every pass — full load,
  // incremental, manual resync — ends by indexing what changed, inside the same single-flight
  // latch. It is best-effort per item and never throws, so the hook cannot fail a pass.
  //
  // An LLM categorizer used to ride here too, filing every doc under one of seven fixed shelves
  // for the Knowledge tab. It went with the shelves (2026-09-03): the tab now groups by the Drive
  // folder the sync already knows, which costs no completion, cannot disagree with itself between
  // passes, and is the filing the people who own the documents actually did.
  const indexer = createChunkIndexer(
    repo,
    options.embeddings ?? createDisabledEmbeddingClient(),
    clock,
    options.indexer,
  )
  // The transcriber rides the injected LLM: present in the running server and the harness, absent
  // in an LLM-less boot — where diagram docs simply stay flagged.
  const transcriber = options.llm
    ? createVisualTranscriber({ llm: options.llm, onError: options.transcriber?.onError })
    : undefined
  const syncService = createKnowledgeSyncService(repo, drive, clock, {
    transcriber,
    ...options.sync,
    afterReconcile: async () => {
      await indexer.ensureIndexed()
    },
  })
  const syncTriggers = createSyncTriggers(syncService, clock, options.triggers)
  return { repo, syncService, syncTriggers }
}

// The conversation half of the assistant module (#90): the author-scoped thread store and the
// service that owns every message write. Split from createAssistantComponents because threads
// depend only on the db and clock, never on Drive — the running server serves the thread routes
// without a provisioned Drive client (deferred, ADR-0014), and the answer path (a later slice)
// composes this with the knowledge grounding above into the one grounded-answer flow.
export interface ConversationComponents {
  threadRepo: ThreadRepository
  threadService: ThreadService
}

export function createConversationComponents(db: Db, clock: Clock): ConversationComponents {
  const threadRepo = createThreadRepository(db)
  const threadService = createThreadService(threadRepo, clock)
  return { threadRepo, threadService }
}

// The answer path (#91, #92, #381): the tool loop over the model, composed over the same
// author-scoped thread repository the conversation store uses, the knowledge cache the sync slice
// fills, and the scoped page reads the tools wrap. Wired separately from
// createConversationComponents because it depends on the injected LLM port — a real fetch-backed
// client in the running server (createHttpLlmClient over resolveLlmConfig, ADR-0018), a scriptable
// fake in the harness — which the thread-persistence routes do not need. The running server always
// wires it (and so validates the selected provider's key at boot, ADR-0018); the separation is what
// lets a route-free or threads-only boot leave the LLM out entirely.
//
// The page reads are injected (the task-board, location, project and auth repositories satisfy
// them) rather than built here, so every tool reuses the one scoped read path its page owns —
// never a second, bespoke query against those tables (ADR-0007). The WhatsApp summaries reader is
// the exception, built here: nothing else in the API reads that table.
export interface AnswerComponents {
  answerService: AnswerService
  // The per-person question limiter, or null when none was asked for; the harness clears it
  // between cases.
  answerRateLimiter: RateLimiter | null
}

// The scoped reads the running server and the harness both hand in.
export type AnswerReads = Pick<
  AssistantToolPorts,
  'tasks' | 'locations' | 'projects' | 'users' | 'access'
>

export function createAnswerComponents(
  db: Db,
  clock: Clock,
  llm: LlmClient,
  // The query-embedding port for chunk retrieval (ADR-0025): the real fetch-backed client in the
  // server, a fake in the harness — where the default (a failing fake) deliberately lands every
  // test on the deterministic keyword path.
  embeddings: EmbeddingClient,
  reads: AnswerReads,
  // The broker's web search to offer beside the tools (#385): the server passes the resolved
  // provider's (null on the direct endpoints), the harness the real definition so a case can
  // assert it rode on the wire. Absent means none.
  options: {
    webSearch?: LlmTool | null
    knowledgeCutoff?: string | null
    // The company's public site, read live. Absent means the tool is not offered.
    website?: CompanyWebsiteReader | null
    // The per-person question limit (2026-09-20). Absent means no limit.
    answerRateLimit?: RateLimiterConfig | null
    // The daily spend alert (2026-09-20): ring the notifier when a day's answers pass the
    // threshold. Absent means nobody rings.
    spendAlert?: { thresholdUsd: number; notifier: OpsNotifier } | null
  } = {},
): AnswerComponents {
  const answerRateLimiter = options.answerRateLimit
    ? createRateLimiter(clock, options.answerRateLimit)
    : null
  const threadRepo = createThreadRepository(db)
  const knowledgeRepo = createKnowledgeRepository(db)
  const answerLog = createAnswerLog(db)
  const spendAlert = options.spendAlert
    ? createSpendAlert({
        log: answerLog,
        thresholdUsd: options.spendAlert.thresholdUsd,
        alert: (spentUsd, thresholdUsd) =>
          (options.spendAlert as { notifier: OpsNotifier }).notifier.alertAdmins(
            spendAlertCopy(spentUsd, thresholdUsd),
          ),
      })
    : null
  const answerService = createAnswerService({
    threads: threadRepo,
    ports: {
      knowledge: knowledgeRepo,
      embeddings,
      whatsapp: createWhatsappSummaryReader(db),
      ...(options.website ? { website: options.website } : {}),
      ...reads,
    },
    llm,
    webSearch: options.webSearch ?? null,
    knowledgeCutoff: options.knowledgeCutoff ?? null,
    log: answerLog,
    clock,
    rateLimiter: answerRateLimiter,
    spendAlert,
  })
  return { answerService, answerRateLimiter }
}
