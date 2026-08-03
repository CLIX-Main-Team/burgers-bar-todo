import { type Task, type TaskStatus, taskStatusSchema } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslations } from 'use-intl'
import { Select } from '../../components/ui/select.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'
import { TaskCard } from './task-card.js'

// An employee's task card with the one write their role has (#134, Slice C): a status picker. It is
// the employee counterpart to ManagedTaskCard — the plain read-only TaskCard plus a single control —
// and, like every write surface, the API stays the sole authority (it authorises the change by scope
// and writes only the status column, so this control can only ever move status on a task already the
// employee's own). The picker reflects task.status straight from the cache, so a change made here (or
// arriving over the live channel) is shown without any local mirror to drift.
export function StatusTaskCard({ task }: { task: Task }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const selectId = useId()

  const mutation = useMutation({
    mutationFn: (status: TaskStatus) => tasksApi.updateTaskStatus(task.id, status),
    // Refetch the board so the acting user's own view reflects the change at once (its completed-at
    // and any priority-sort position follow); other viewers get it over the live channel.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  return (
    <TaskCard
      task={task}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-sm font-medium text-foreground">
            {t('tasks.statusLabel')}
          </label>
          <Select
            id={selectId}
            className="h-9 w-auto py-1"
            value={task.status}
            disabled={mutation.isPending}
            onChange={(event) => mutation.mutate(event.target.value as TaskStatus)}
          >
            {/* The enum's own order (not_started → in_progress → done); any → any is allowed, a
                mis-tap is reversible and nothing is gated. One source of truth with the schema. */}
            {taskStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {t(taskStatusLabelKey(status))}
              </option>
            ))}
          </Select>
          {mutation.isError ? (
            <span className="text-xs text-destructive">{t('tasks.statusFailed')}</span>
          ) : null}
        </div>
      }
    />
  )
}
