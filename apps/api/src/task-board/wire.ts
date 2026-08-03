import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import { type TaskBoardEvents, createTaskBoardEvents } from './events.js'
import { type TaskBoardRepository, createTaskBoardRepository } from './repository.js'
import { type TaskBoardService, createTaskBoardService } from './service.js'

// The task-board composition root (#131 Slice A, #132 Slice A2), mirroring auth/wire.ts: build the
// data-access repository, the board service, and the in-process change bus against an injected db
// and clock, and hand them back for the server and the integration harness to register through
// buildApp. The write slices (B–D) will publish to `events`; A2's SSE fan-out is its only consumer.
export interface TaskBoardComponents {
  repository: TaskBoardRepository
  boardService: TaskBoardService
  events: TaskBoardEvents
}

export function createTaskBoardComponents(db: Db, clock: Clock): TaskBoardComponents {
  const repository = createTaskBoardRepository(db)
  const boardService = createTaskBoardService(repository, clock)
  const events = createTaskBoardEvents()
  return { repository, boardService, events }
}
