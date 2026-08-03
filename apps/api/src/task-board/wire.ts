import type { Clock } from '../auth/clock.js'
import type { Db } from '../db/client.js'
import { type TaskBoardRepository, createTaskBoardRepository } from './repository.js'
import { type TaskBoardService, createTaskBoardService } from './service.js'

// The task-board composition root (#131 Slice A), mirroring auth/wire.ts: build the data-access
// repository and the board service against an injected db and clock, and hand them back for the
// server and the integration harness to register through buildApp. Slices A2–D grow this bag with
// the SSE channel and the write services as they land.
export interface TaskBoardComponents {
  repository: TaskBoardRepository
  boardService: TaskBoardService
}

export function createTaskBoardComponents(db: Db, clock: Clock): TaskBoardComponents {
  const repository = createTaskBoardRepository(db)
  const boardService = createTaskBoardService(repository, clock)
  return { repository, boardService }
}
