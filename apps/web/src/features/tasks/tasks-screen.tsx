import type { Task } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { USERS_QUERY_KEY } from '../people/user-list.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { ManagedTaskCard } from './managed-task-card.js'
import { TaskCard } from './task-card.js'
import { TaskForm } from './task-form.js'

const priorityRank: Record<Task['priority'], number> = { high: 3, normal: 2, low: 1 }

// The high→low priority sort is a per-viewer lens over the server's shared manual order. It never
// asks the server to reorder and never touches `position`: it sorts a *copy* by priority, and
// because Array.prototype.sort is stable, same-priority tasks keep the manual order they arrived in
// — the stable tiebreak the board promises. Turning the toggle off simply renders the server list
// as-is, restoring the manual order. (Drag, and disabling it while this sort is on, land in Slice D.)
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
        <p className="text-sm text-muted-foreground">{t('common.working')}</p>
      ) : query.isError ? (
        <Alert tone="error">{t('tasks.loadFailed')}</Alert>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.empty')}</p>
      ) : (
        <>
          {/* Announce the active sort for assistive tech without a visible duplicate of the toggle. */}
          <p className="sr-only" aria-live="polite">
            {sortByPriority ? t('tasks.sortByPriorityOn') : ''}
          </p>
          <ul className="flex flex-col gap-3">
            {orderTasks(tasks, sortByPriority).map((task) => (
              <li key={task.id}>
                {canWrite && principal ? (
                  <ManagedTaskCard task={task} users={users} principal={principal} />
                ) : (
                  <TaskCard task={task} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
