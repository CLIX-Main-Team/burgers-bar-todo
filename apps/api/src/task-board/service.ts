import type { Clock } from '../auth/clock.js'
import type { Principal } from '../auth/principal.js'
import type { TaskBoardRepository, TaskRow } from './repository.js'

// What one board open returns: the scoped tasks, plus the last-seen marker as it stood before
// this open (null the first time ever). Dates here; the route stringifies them to ISO.
export interface Board {
  tasks: TaskRow[]
  lastSeenAt: Date | null
}

export interface TaskBoardService {
  // Open the board for this principal: read the scoped tasks and, as a side effect, bump this
  // user's last-seen marker (#131 owns this trigger; #59's badge reads the marker).
  getBoard(principal: Principal): Promise<Board>
}

export function createTaskBoardService(
  repository: TaskBoardRepository,
  clock: Clock,
): TaskBoardService {
  return {
    getBoard: async (principal) => {
      // Read the marker as it stood before this open, then advance it to now. Read-before-bump so
      // the returned value answers "when did you last see the board" (null the first time) — which
      // is what makes the trigger observable through a follow-up read and what #59's badge dates
      // from. Uses the injected clock so tests drive "now" deterministically.
      const lastSeenAt = await repository.readLastSeen(principal.userId)
      await repository.bumpLastSeen(principal.userId, clock.now())
      const tasks = await repository.listScopedTasks(principal)
      return { tasks, lastSeenAt }
    },
  }
}
