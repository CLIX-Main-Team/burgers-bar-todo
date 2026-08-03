import {
  type Task,
  type TaskBoardEvent,
  type TaskBoardResponse,
  taskBoardEventSchema,
} from '@burgers/shared'
import { useEffect } from 'react'
import { tasksApi } from '../../lib/api.js'
import { queryClient } from '../../lib/query-client.js'

// The board's live-channel client (#132, Slice A2, ADR-0015). The board updates in place: a native
// EventSource carries scope-filtered change events (the server has already decided this viewer may
// see each one), and this module patches the TanStack Query cache from the stream so no refetch is
// needed. refetchOnWindowFocus is off for the board (query-client) precisely because this channel,
// not polling, keeps it fresh — with the plain read as the fallback when the channel is unavailable.

// The one cache key the board read and the live patch share. Owned here (the reducer and the read
// must agree on it) and imported by the screen, so the dependency runs screen → stream, never back.
export const TASKS_QUERY_KEY = ['tasks', 'board'] as const

// The shared manual order the board opens to: position ascending, id as the stable tiebreak. This
// mirrors the API's orderBy exactly (repository.listScopedTasks), so a task patched in from the
// stream lands where a fresh read would have placed it, and the client-side priority sort stays a
// pure lens over the same order.
function byManualOrder(a: Task, b: Task): number {
  if (a.position !== b.position) return a.position - b.position
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Fold one board event into the cached board. A `task.upserted` replaces the task if the board
// already holds it, else inserts it, then restores the manual order. Patching only ever touches an
// already-loaded board: with no board cached yet there is nothing to fold into, and the pending
// read will bring this task down anyway, so the event is dropped rather than used to fabricate a
// one-task board out of order. Exported pure so the fold is unit-reasonable in isolation.
export function applyTaskEvent(
  prev: TaskBoardResponse | undefined,
  event: TaskBoardEvent,
): TaskBoardResponse | undefined {
  if (!prev) return prev
  const { task } = event
  const tasks = [...prev.tasks.filter((t) => t.id !== task.id), task].sort(byManualOrder)
  return { ...prev, tasks }
}

// Subscribe the board to the live channel for the lifetime of the mounting screen. Opens a native
// EventSource (its built-in reconnect is exactly the resilience ADR-0015 asks for — a dropped
// connection re-opens on its own and resumes), folds each valid event into the cache, and closes
// the connection on unmount. A frame that fails to parse is ignored rather than allowed to throw,
// so a stray or malformed message can never take the board down.
export function useBoardStream(): void {
  useEffect(() => {
    const url = tasksApi.streamUrl()
    if (!url) return

    const source = new EventSource(url)
    source.onmessage = (message) => {
      let event: TaskBoardEvent
      try {
        event = taskBoardEventSchema.parse(JSON.parse(message.data))
      } catch {
        return
      }
      queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
        applyTaskEvent(prev, event),
      )
    }

    return () => source.close()
  }, [])
}
