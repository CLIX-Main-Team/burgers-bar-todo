import type { ReorderTasksRequest, Task, TaskBoardResponse } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { USERS_QUERY_KEY } from '../people/user-list.js'
import { BoardEmpty, BoardError, BoardLoading } from './board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { DraggableTaskList } from './draggable-task-list.js'
import { ManagedTaskCard } from './managed-task-card.js'
import { applyReorder } from './reorder.js'
import { StatusTaskCard } from './status-task-card.js'
import { TaskForm } from './task-form.js'

const priorityRank: Record<Task['priority'], number> = { high: 3, normal: 2, low: 1 }

// The high→low priority sort is a per-viewer lens over the server's shared manual order. It never
// asks the server to reorder and never touches `position`: it sorts a *copy* by priority, and
// because Array.prototype.sort is stable, same-priority tasks keep the manual order they arrived in
// — the stable tiebreak the board promises. Turning the toggle off simply renders the server list
// as-is, restoring the manual order. Drag (#135, Slice D) is disabled while this lens is on, so the
// two never fight: a writer reorders the shared `position` order only when viewing that order.
function orderTasks(tasks: Task[], sortByPriority: boolean): Task[] {
  if (!sortByPriority) return tasks
  return [...tasks].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])
}

// The task board — the app's home surface after login (#131, Slice A). It renders the scoped read:
// what the caller sees (their own assigned tasks, their location, or the whole chain) is decided by
// the API from the principal, never asked for here. Opening the board is also the last-seen trigger
// — this read bumps the per-user marker server-side, which #59's Tasks-tab badge later reads.
export function TasksScreen() {
  const t = useTranslations()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [sortByPriority, setSortByPriority] = useState(false)
  const [creating, setCreating] = useState(false)
  const query = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  // Subscribe to the live channel (#132): scope-filtered changes patch the query cache in place, so
  // the board stays fresh without polling. The plain read above is the fallback if the channel is
  // unavailable.
  useBoardStream()

  // Only a manager or admin writes to the board (#133); an employee sees a read-only board (the API
  // refuses their writes regardless). The people read backs the assignee picker — it needs the
  // provisioning surface's scoped list, so it runs only for a writer, who is allowed that read.
  const canWrite = principal ? principal.role !== 'employee' : false
  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: authApi.listUsers,
    enabled: canWrite,
  })
  const users = usersQuery.data?.users ?? []

  const tasks = query.data?.tasks ?? []

  // The shared-order write (#135, Slice D). Only a manager or admin reaches it (the drag surface is
  // theirs alone), and the API re-authorises by scope regardless (ADR-0007). The board is patched
  // optimistically the instant a drop lands — below, before this fires — so the move never waits on
  // the network; a failure rolls back by refetching the server's truth, and a success needs no work
  // because the reorder's own live events re-confirm the same order on this and every other board.
  const reorderMutation = useMutation({
    mutationFn: (command: ReorderTasksRequest) =>
      tasksApi.reorderTasks(command.orderedIds, command.locationId),
    onError: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  // A drop names the dragged task and the slot it landed on. Resolve it to the optimistic board and
  // the scoped command (a no-op or unknown id yields null and is dropped), patch the cache so the new
  // order shows at once, then send the write. `tasks` is the shared manual order here — drag is only
  // offered while the priority lens is off — so it is exactly what the list displayed.
  const handleReorder = (activeId: string, overId: string) => {
    const result = applyReorder(tasks, activeId, overId)
    if (!result) return
    queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
      prev ? { ...prev, tasks: result.tasks } : prev,
    )
    reorderMutation.mutate(result.command)
  }

  // A writer viewing the shared manual order may drag to reorder it; the priority lens disables drag
  // (they are viewing a per-viewer sort, not the order the write sets), and an employee never drags.
  const canReorder = canWrite && !sortByPriority

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t('tasks.title')}</h1>
        <div className="flex items-center gap-2">
          {tasks.length > 0 ? (
            <Button
              variant={sortByPriority ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={sortByPriority}
              onClick={() => setSortByPriority((on) => !on)}
            >
              {sortByPriority ? t('tasks.manualOrder') : t('tasks.sortByPriority')}
            </Button>
          ) : null}
          {canWrite && !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              {t('tasks.newTask')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* The create form sits above the board so a new task is written where it will appear. Gated to
          a writer and mounted only while open, so its react-hook-form state resets each time. */}
      {canWrite && creating && principal ? (
        <TaskForm
          mode="create"
          principal={principal}
          users={users}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {query.isPending ? (
        <BoardLoading />
      ) : query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : tasks.length === 0 ? (
        <BoardEmpty canCreate={canWrite} onCreate={() => setCreating(true)} />
      ) : (
        <>
          {/* A failed reorder rolled the board back to the server's order; tell the writer so a lost
              drag is not silent. Optimism means the common path shows nothing here. */}
          {reorderMutation.isError ? <Alert tone="error">{t('tasks.reorderFailed')}</Alert> : null}
          {/* Announce the active sort for assistive tech without a visible duplicate of the toggle. */}
          <p className="sr-only" aria-live="polite">
            {sortByPriority ? t('tasks.sortByPriorityOn') : ''}
          </p>
          {canReorder && principal ? (
            // A manager/admin viewing the shared manual order: the board is draggable (#135).
            <DraggableTaskList
              tasks={tasks}
              users={users}
              principal={principal}
              onReorder={handleReorder}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {orderTasks(tasks, sortByPriority).map((task) => (
                <li key={task.id}>
                  {canWrite && principal ? (
                    <ManagedTaskCard task={task} users={users} principal={principal} />
                  ) : (
                    // An employee's board is read-only but for the one status control (#134, Slice C).
                    <StatusTaskCard task={task} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
