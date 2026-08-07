import type { TaskBoardResponse } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../auth/session.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// How often the shell re-reads the board while the user is elsewhere (#136). The badge is
// near-live, not live: the SSE channel stays screen-owned (mounting it in the shell would put a
// second EventSource under every stubbed screen test), so away from the board a poll carries new
// assignments in. On the board itself the stream keeps the same cached query fresh anyway.
const BADGE_REFETCH_MS = 60_000

// How many of this viewer's assignments are newer than their board last-seen marker (#136) — the
// number the Tasks-tab badge shows. Counted per task, not per assignee row, and only rows naming
// this user: someone else being added to a shared task is their news, not this viewer's. A marker
// exactly at assignedAt means seen (strictly newer counts), and a null marker — the user has never
// opened the board — makes every current assignment new. Edits never re-badge: the API preserves an
// unchanged assignee's assignedAt across edits, so only a genuinely new assignment moves the count.
// Pure over the board response so the boundaries are unit-reasonable in isolation.
export function countUnseenAssignments(
  board: TaskBoardResponse | undefined,
  userId: string,
): number {
  if (!board) return 0
  let count = 0
  for (const task of board.tasks) {
    const mine = task.assignees.find((assignee) => assignee.id === userId)
    if (!mine) continue
    if (board.lastSeenAt === null || Date.parse(mine.assignedAt) > Date.parse(board.lastSeenAt)) {
      count += 1
    }
  }
  return count
}

// The count for the shell's Tasks destination (tab-bar and side-nav both read it). Observes the
// same query key the board screen owns, so the two never fetch twice; the interval is what keeps
// the badge near-live from other screens. The caller hides the badge while the Tasks destination
// is active — on the board, the visit itself is the acknowledgement.
export function useUnseenTasksCount(): number {
  const { principal } = useSession()
  const query = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: tasksApi.board,
    refetchInterval: BADGE_REFETCH_MS,
    enabled: principal !== null,
  })
  return principal ? countUnseenAssignments(query.data, principal.userId) : 0
}
