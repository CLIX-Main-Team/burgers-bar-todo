import type { Task } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { StatusControl } from '../../components/ui/status-control.js'
import { TaskCard } from './task-card.js'
import { useTaskStatusMutation } from './task-menu.js'

// An employee's task card with the one write their role has (#223, task-board mockup): the
// status change, carried by an always-visible StatusControl pill in the card's meta row — their
// sole move affordance, since an employee cannot drag. The pill replaces the hidden overflow
// "Move to…" menu the earlier slice used (audit X5): the lane names where a task sits, the pill
// is how the employee moves it. Like every write surface, the API stays the sole authority: it
// authorises the change by scope and writes only the status column, so this can only ever move a
// task already the employee's own. The card reflects task.status straight from the cache, so a
// change here (or arriving over the live channel) shows without any local mirror to drift.
export function StatusTaskCard({ task }: { task: Task }) {
  const t = useTranslations()
  const move = useTaskStatusMutation(task.id)

  return (
    <TaskCard
      task={task}
      statusControl={
        <StatusControl
          status={task.status}
          disabled={move.isPending}
          onSelect={(status) => move.mutate(status)}
          // Names which task's status the menu changes; the pill's own status label names the
          // trigger.
          label={t('tasks.changeStatus', { title: task.title })}
        />
      }
      notice={
        move.isError ? <p className="text-xs text-destructive">{t('tasks.statusFailed')}</p> : null
      }
    />
  )
}
