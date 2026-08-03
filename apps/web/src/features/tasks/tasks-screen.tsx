import type { Task } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { TaskCard } from './task-card.js'

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
  const [sortByPriority, setSortByPriority] = useState(false)
  const query = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  // Subscribe to the live channel (#132): scope-filtered changes patch the query cache in place, so
  // the board stays fresh without polling. The plain read above is the fallback if the channel is
  // unavailable.
  useBoardStream()

  const tasks = query.data?.tasks ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">{t('tasks.title')}</h1>
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
      </div>

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
                <TaskCard task={task} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
