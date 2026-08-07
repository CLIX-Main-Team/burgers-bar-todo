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
  // user's last-seen marker (#131 owns this trigger; #136's badge reads the marker). A peek
  // (#136) is the same read with the side effect withheld: the shell's badge poll reads the board
  // and the marker without a background fetch ever counting as the user seeing anything.
  getBoard(principal: Principal, options?: { peek?: boolean }): Promise<Board>
  // One changed task as this principal is allowed to see it, or null when it falls outside their
  // scope. The SSE fan-out (#132) calls this per subscriber for each change on the board bus, so a
  // client is pushed a change only when the same scope predicate that gates reads admits the task.
  // Unlike getBoard this has no last-seen side effect — a live push is not the user opening the
  // board, so it must not move the marker the badge dates from.
  getVisibleTask(principal: Principal, taskId: string): Promise<TaskRow | null>
  // The user actually looked at the board (#136): advance their last-seen marker to now and
  // report where it landed, so the client can clear its badge from the response alone.
  markSeen(principal: Principal): Promise<Date>
}

export function createTaskBoardService(
  repository: TaskBoardRepository,
  clock: Clock,
): TaskBoardService {
  return {
    getBoard: async (principal, options) => {
      // Read the marker as it stood before this open, then advance it to now. Read-before-bump so
      // the returned value answers "when did you last see the board" (null the first time) — which
      // is what makes the trigger observable through a follow-up read and what #136's badge dates
      // from. Uses the injected clock so tests drive "now" deterministically. A peek withholds the
      // bump: the badge's background poll must never masquerade as the user opening the board.
      const lastSeenAt = await repository.readLastSeen(principal.userId)
      if (!options?.peek) {
        await repository.bumpLastSeen(principal.userId, clock.now())
      }
      const tasks = await repository.listScopedTasks(principal)
      return { tasks, lastSeenAt }
    },

    getVisibleTask: (principal, taskId) => repository.getScopedTask(principal, taskId),

    markSeen: async (principal) => {
      const at = clock.now()
      await repository.bumpLastSeen(principal.userId, at)
      return at
    },
  }
}
