import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import type { TaskNotifier } from '../notifications/task-notifier.js'
import { type TaskBoardEvents, createTaskBoardEvents } from './events.js'
import { type TaskBoardRepository, createTaskBoardRepository } from './repository.js'
import { type TaskBoardService, createTaskBoardService } from './service.js'
import { type TaskWriteService, createTaskWriteService } from './task-write-service.js'

// The task-board composition root (#131 Slice A, #132 Slice A2, #133 Slice B), mirroring
// auth/wire.ts: build the data-access repository, the read board service, the write service, and the
// in-process change bus against an injected db and clock, and hand them back for the server and the
// integration harness to register through buildApp. Slice B's writes publish to `events`; A2's SSE
// fan-out is its only consumer, and the read and write services share the one scoped repository.
export interface TaskBoardComponents {
  repository: TaskBoardRepository
  boardService: TaskBoardService
  writeService: TaskWriteService
  events: TaskBoardEvents
}

// The notifier is injected rather than built here for the same reason the clock is: it is a seam
// with three different bodies behind it — the real FCM transport, the no-op one a deployment with
// no Firebase credentials runs, and the capturing fake the tests assert on — and the board itself
// must not care which it was handed (#59).
export function createTaskBoardComponents(
  db: Db,
  clock: Clock,
  notifier: TaskNotifier,
): TaskBoardComponents {
  const repository = createTaskBoardRepository(db)
  const boardService = createTaskBoardService(repository, clock)
  const events = createTaskBoardEvents()
  const writeService = createTaskWriteService(repository, events, notifier)
  return { repository, boardService, writeService, events }
}
