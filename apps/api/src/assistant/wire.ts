import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import { type AnswerService, createAnswerService } from './answer-service.js'
import type { DriveClient } from './drive-client.js'
import { type KnowledgeSyncService, createKnowledgeSyncService } from './knowledge-sync.js'
import type { LlmClient } from './llm-client.js'
import { type KnowledgeRepository, createKnowledgeRepository } from './repository.js'
import { type SyncTriggers, type SyncTriggersOptions, createSyncTriggers } from './sync-triggers.js'
import { type ThreadRepository, createThreadRepository } from './thread-repository.js'
import { type ThreadService, createThreadService } from './thread-service.js'

// The single composition point for the assistant module, mirroring auth/wire.ts, so the
// running server and the integration-test harness wire the same objects the same way. The db,
// clock, and Drive client are injected — a real pool + systemClock + the googleapis-backed
// Drive adapter in prod (deferred behind provisioning, ADR-0014); the test Postgres + a mutable
// clock + the scriptable fake under test. The sync triggers (#89) — login fire-and-forget, the
// backstop poll, the manual resync — are composed here over the one reconciliation service, so
// every caller shares its single-flight latch.

export interface AssistantComponents {
  repo: KnowledgeRepository
  syncService: KnowledgeSyncService
  // The three usage-driven sync triggers (ADR-0014), wired over syncService above. The sign-in
  // route fires onLogin, the server's backstop timer drives pollBackstop, and the resync endpoint
  // awaits resyncNow.
  syncTriggers: SyncTriggers
}

export function createAssistantComponents(
  db: Db,
  clock: Clock,
  drive: DriveClient,
  triggerOptions: SyncTriggersOptions = {},
): AssistantComponents {
  const repo = createKnowledgeRepository(db)
  const syncService = createKnowledgeSyncService(repo, drive, clock)
  const syncTriggers = createSyncTriggers(syncService, clock, triggerOptions)
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

// The grounded answer path (#91): the single synchronous LLM exchange, composed over the same
// author-scoped thread repository the conversation store uses and the knowledge cache the sync slice
// fills. Wired separately from createConversationComponents because it depends on the injected LLM
// port — a real fetch-backed client in the running server (createHttpLlmClient over resolveLlmConfig,
// ADR-0018), a scriptable fake in the harness — which the thread-persistence routes do not need. The
// running server always wires it (and so validates the selected provider's key at boot, ADR-0018);
// the separation is what lets a route-free or threads-only boot leave the LLM out entirely.
export interface AnswerComponents {
  answerService: AnswerService
}

export function createAnswerComponents(db: Db, clock: Clock, llm: LlmClient): AnswerComponents {
  const threadRepo = createThreadRepository(db)
  const knowledgeRepo = createKnowledgeRepository(db)
  const answerService = createAnswerService({
    threads: threadRepo,
    knowledge: knowledgeRepo,
    llm,
    clock,
  })
  return { answerService }
}
