import type { PrincipalResponse, Task, UserSummary } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'
import { TaskCard } from './task-card.js'
import { TaskForm } from './task-form.js'

// A task card with the manager/admin write controls (#133, Slice B): edit swaps the card for the
// full-update form, delete asks for a one-tap confirmation before removing the task. Rendered only
// for a manager or admin — an employee's board renders the plain read-only TaskCard — and the API
// authorises every write regardless (a task outside the caller's scope is refused server-side).
export function ManagedTaskCard({
  task,
  users,
  principal,
}: {
  task: Task
  users: UserSummary[]
  principal: PrincipalResponse
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  // Delete is two-tap (Delete → Confirm) rather than a native confirm() dialog: it reads the same in
  // both languages and both directions, and a mis-tap is one click from cancelled.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.deleteTask(task.id),
    // Refetch the board so the deleted card leaves the acting user's view at once (other viewers see
    // it go on their next read — a deletion is not relayed over the upsert-only live channel).
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  if (editing) {
    return (
      <TaskForm
        mode="edit"
        principal={principal}
        users={users}
        task={task}
        onClose={() => setEditing(false)}
      />
    )
  }

  return (
    <TaskCard
      task={task}
      footer={
        confirmingDelete ? (
          <>
            <span className="text-sm text-foreground">{t('tasks.confirmDelete')}</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? t('common.working') : t('tasks.delete')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmingDelete(false)}
            >
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              {t('tasks.edit')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
              {t('tasks.delete')}
            </Button>
            {deleteMutation.isError ? (
              <span className="text-xs text-destructive">{t('tasks.deleteFailed')}</span>
            ) : null}
          </>
        )
      }
    />
  )
}
