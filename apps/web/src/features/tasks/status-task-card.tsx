import type { Task } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { DropdownMenu } from '../../components/ui/dropdown-menu.js'
import { TaskCard } from './task-card.js'
import { MoveToItems, overflowTrigger, useTaskStatusMutation } from './task-menu.js'

// An employee's task card with the one write their role has (#213, task-board mockup): the
// status change, now collapsed into the same quiet overflow menu the manager card uses — the
// per-card status <select> is gone. The menu carries only "Move to…" (an employee cannot edit
// or delete), so their board reads exactly as read-only but for that one control. Like every
// write surface, the API stays the sole authority: it authorises the change by scope and writes
// only the status column, so this can only ever move a task already the employee's own. The
// card reflects task.status straight from the cache, so a change here (or arriving over the
// live channel) shows without any local mirror to drift.
export function StatusTaskCard({ task }: { task: Task }) {
  const t = useTranslations()
  const move = useTaskStatusMutation(task.id)
  // One phrase for both the menu's accessible name and its trigger's aria-label.
  const actionsLabel = t('tasks.taskActions', { title: task.title })

  return (
    <TaskCard
      task={task}
      actions={
        <DropdownMenu label={actionsLabel} trigger={overflowTrigger(actionsLabel)}>
          <MoveToItems
            status={task.status}
            disabled={move.isPending}
            onMove={(status) => move.mutate(status)}
          />
        </DropdownMenu>
      }
      notice={
        move.isError ? <p className="text-xs text-destructive">{t('tasks.statusFailed')}</p> : null
      }
    />
  )
}
