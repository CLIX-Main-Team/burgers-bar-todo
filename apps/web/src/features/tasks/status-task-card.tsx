import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { StatusControl } from '../../components/ui/status-control.js'
import { TaskCard } from './task-card.js'
import { useTaskStatusMutation } from './task-menu.js'

// An employee's task card with the one write their role has (#223, task-board mockup): the
// status change, carried two ways that are the same write — dragging the card to another lane
// (the grip, threaded in by the board's status-only drag mode) and the always-visible
// StatusControl pill in the meta row, the accessible, no-pointer fallback the mockup kept. The
// pill replaces the hidden overflow "Move to…" menu the earlier slice used (audit X5). Like
// every write surface, the API stays the sole authority: it authorises the change by scope and
// writes only the status column, so either gesture can only ever move a task already the
// employee's own. The card reflects task.status straight from the cache, so a change here (or
// arriving over the live channel) shows without any local mirror to drift.
export function StatusTaskCard({ task, grip }: { task: Task; grip?: ReactNode }) {
  const t = useTranslations()
  const move = useTaskStatusMutation(task.id)

  return (
    <TaskCard
      task={task}
      grip={grip}
      // Everything on an employee's board is their own assignment, so the card drops the
      // assignee stack and the due date leads the meta row alone, beside the pill.
      ownTasks
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
