import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import type { DriveClient } from './drive-client.js'
import { type KnowledgeSyncService, createKnowledgeSyncService } from './knowledge-sync.js'
import { type KnowledgeRepository, createKnowledgeRepository } from './repository.js'
import { type ThreadRepository, createThreadRepository } from './thread-repository.js'
import { type ThreadService, createThreadService } from './thread-service.js'

// The single composition point for the assistant module, mirroring auth/wire.ts, so the
// running server and the integration-test harness wire the same objects the same way. The db,
// clock, and Drive client are injected — a real pool + systemClock + the googleapis-backed
// Drive adapter in prod (deferred behind provisioning, ADR-0014); the test Postgres + a mutable
// clock + the scriptable fake under test. This slice establishes the module; later Slice 1 and
// Slice 2 tickets (format widening, sync triggers, the answer path) extend these components
// rather than re-scaffolding the module.

export interface AssistantComponents {
  repo: KnowledgeRepository
  syncService: KnowledgeSyncService
}

export function createAssistantComponents(
  db: Db,
  clock: Clock,
  drive: DriveClient,
): AssistantComponents {
  const repo = createKnowledgeRepository(db)
  const syncService = createKnowledgeSyncService(repo, drive, clock)
  return { repo, syncService }
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
