import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import { createAnswerLog } from './answer-log.js'
import {
  type AnswerService,
  type TaskContextReader,
  createAnswerService,
} from './answer-service.js'
import { type ChunkIndexerOptions, createChunkIndexer } from './chunk-index.js'
import type { DriveClient } from './drive-client.js'
import { type EmbeddingClient, createDisabledEmbeddingClient } from './embedding-client.js'
import {
  type KnowledgeCategorizerOptions,
  createKnowledgeCategorizer,
} from './knowledge-categorizer.js'
import {
  type KnowledgeSyncOptions,
  type KnowledgeSyncService,
  createKnowledgeSyncService,
} from './knowledge-sync.js'
import type { LlmClient } from './llm-client.js'
import { type KnowledgeRepository, createKnowledgeRepository } from './repository.js'
import { type SyncTriggers, type SyncTriggersOptions, createSyncTriggers } from './sync-triggers.js'
import { type ThreadRepository, createThreadRepository } from './thread-repository.js'
import { type ThreadService, createThreadService } from './thread-service.js'
import { createVisualTranscriber } from './visual-transcriber.js'

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
  // The LLM the knowledge categorizer files docs with (ADR-0024) — the same port the answer
  // path calls, injected so the harness scripts a fake. When absent, the sync simply runs
  // without filing (a threads-only or categorizer-less boot changes nothing else).
  llm?: LlmClient
  // Per-doc filing-failure reporting, mirroring sync.onDocumentError: a logger in the running
  // server, a collector in tests.
  categorizer?: KnowledgeCategorizerOptions
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
  // The categorizer and the chunk indexer ride the sync's afterReconcile seam so every pass —
  // full load, incremental, manual resync — ends by indexing what changed and filing whatever is
  // still uncategorized, inside the same single-flight latch. Both are best-effort per item and
  // never throw, so the hook cannot fail a pass. The indexer runs first: grounding correctness
  // depends on it, while filing is a Knowledge-tab nicety.
  const categorizer = options.llm
    ? createKnowledgeCategorizer(repo, options.llm, clock, options.categorizer)
    : undefined
  const indexer = createChunkIndexer(
    repo,
    options.embeddings ?? createDisabledEmbeddingClient(),
    clock,
    options.indexer,
  )
  // The transcriber rides the same injected LLM the categorizer does: present in the running
  // server and the harness, absent in an LLM-less boot — where diagram docs simply stay flagged.
  const transcriber = options.llm
    ? createVisualTranscriber({ llm: options.llm, onError: options.transcriber?.onError })
    : undefined
  const syncService = createKnowledgeSyncService(repo, drive, clock, {
    transcriber,
    ...options.sync,
    afterReconcile: async () => {
      await indexer.ensureIndexed()
      if (categorizer) {
        await categorizer.categorizePending()
      }
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

// The grounded answer path (#91, #92): the single synchronous LLM exchange, composed over the same
// author-scoped thread repository the conversation store uses, the knowledge cache the sync slice
// fills, and — for task grounding (#92) — the ADR-0007-scoped board read. Wired separately from
// createConversationComponents because it depends on the injected LLM port — a real fetch-backed
// client in the running server (createHttpLlmClient over resolveLlmConfig, ADR-0018), a scriptable
// fake in the harness — which the thread-persistence routes do not need. The running server always
// wires it (and so validates the selected provider's key at boot, ADR-0018); the separation is what
// lets a route-free or threads-only boot leave the LLM out entirely. The task reader is injected
// (the task-board repository satisfies it) rather than built here, so the answer path reuses the one
// scoped read path the board owns — never a second, bespoke query against the task tables (ADR-0007).
export interface AnswerComponents {
  answerService: AnswerService
}

export function createAnswerComponents(
  db: Db,
  clock: Clock,
  llm: LlmClient,
  tasks: TaskContextReader,
  // The query-embedding port for chunk retrieval (ADR-0025): the real fetch-backed client in the
  // server, a fake in the harness — where the default (a failing fake) deliberately lands every
  // test on the deterministic keyword path.
  embeddings: EmbeddingClient,
): AnswerComponents {
  const threadRepo = createThreadRepository(db)
  const knowledgeRepo = createKnowledgeRepository(db)
  const answerService = createAnswerService({
    threads: threadRepo,
    knowledge: knowledgeRepo,
    tasks,
    llm,
    embeddings,
    log: createAnswerLog(db),
    clock,
  })
  return { answerService }
}
