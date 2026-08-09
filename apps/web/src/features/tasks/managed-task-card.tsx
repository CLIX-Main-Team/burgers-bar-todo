import type { Task } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'
import { TaskCard } from './task-card.js'
import { MoveToItems, overflowTrigger, useTaskStatusMutation } from './task-menu.js'

// A task card with the manager/admin write controls (#213, task-board mockup §TaskCard). The
// audit's always-visible Edit/Delete footer is gone: the actions collapse into one quiet overflow
// menu carrying Edit (which opens the shared TaskFormSheet the board owns — #215), Move to… (the
// status change, drag's accessible equivalent), and Delete, which routes its confirmation through
// an AlertDialog rather than an inline two-tap. Rendered only for a manager or admin — an
// employee's board renders the StatusTaskCard — and the API authorises every write regardless (a
// task outside the caller's scope is refused server-side).
//
// Edit is lifted to the screen: the card reports "edit this task" up through `onEdit`, and one
// TaskFormSheet opens over the board (a drawer on desktop) rather than each card mounting its own
// inline form. Delete stays local — a quick destroy from the card that never opens the sheet.
export function ManagedTaskCard({
  task,
  onEdit,
  grip,
  locationName,
}: {
  task: Task
  // Open the shared edit sheet for this task; owned by the screen.
  onEdit: (task: Task) => void
  // The drag handle, supplied by the reorder surface; absent when drag is off.
  grip?: ReactNode
  // The task's branch name for the card chip — supplied only on an admin's chain-wide board.
  locationName?: string
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const move = useTaskStatusMutation(task.id)
  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.deleteTask(task.id),
    // Refetch the board so the deleted card leaves the acting user's view at once (other viewers
    // see it go on their next read — a deletion is not relayed over the upsert-only live channel).
    onSuccess: () => {
      setConfirmingDelete(false)
      void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    },
  })

  const anyError = move.isError || deleteMutation.isError
  // The menu's accessible name and its trigger's aria-label are the same phrase — compute once.
  const actionsLabel = t('tasks.taskActions', { title: task.title })

  return (
    <>
      <TaskCard
        task={task}
        grip={grip}
        locationName={locationName}
        // The same StatusControl pill the employee card carries (owner decision 2026-08): one
        // consistent status affordance on every card, and the only cross-lane move on the tabbed
        // mobile board, where a single visible lane leaves drag nothing to cross into. The
        // overflow "Move to…" stays as the same write's menu-and-keyboard path.
        statusControl={
          <StatusControl
            status={task.status}
            disabled={move.isPending}
            onSelect={(status) => move.mutate(status)}
            label={t('tasks.changeStatus', { title: task.title })}
          />
        }
        actions={
          <DropdownMenu label={actionsLabel} trigger={overflowTrigger(actionsLabel)}>
            <DropdownMenuItem onSelect={() => onEdit(task)}>
              <Icon name="edit" size="sm" />
              {t('tasks.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <MoveToItems
              status={task.status}
              disabled={move.isPending}
              onMove={(status) => move.mutate(status)}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem tone="destructive" onSelect={() => setConfirmingDelete(true)}>
              <Icon name="delete" size="sm" />
              {t('tasks.delete')}
            </DropdownMenuItem>
          </DropdownMenu>
        }
        notice={
          anyError ? (
            <p className="text-xs text-destructive">
              {move.isError ? t('tasks.statusFailed') : t('tasks.deleteFailed')}
            </p>
          ) : null
        }
      />

      <AlertDialog
        open={confirmingDelete}
        title={t('tasks.confirmDelete')}
        confirmLabel={t('tasks.delete')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}
