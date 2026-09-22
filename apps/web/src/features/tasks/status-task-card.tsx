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
export function StatusTaskCard({
  task,
  grip,
  onOpen,
}: {
  task: Task
  grip?: ReactNode
  // Opens the read-only sheet (task-view-dialog.tsx, owner ask 2026-09-22): the card says the
  // title and the date, the sheet says the rest.
  onOpen: (task: Task) => void
}) {
  const t = useTranslations()
  const move = useTaskStatusMutation(task.id)

  return (
    // The wrapper and the lift are the writer card's (board-task-card.tsx): the title's
    // card-wide open overlay needs a positioned box to stop at, and the status pill sits above
    // it or its press would open the sheet instead.
    <div className="relative">
      <TaskCard
        task={task}
        grip={grip}
        onOpenTitle={() => onOpen(task)}
        statusControl={
          <span className="relative z-10">
            <StatusControl
              status={task.status}
              disabled={move.isPending}
              onSelect={(status) => move.mutate(status)}
              // Names which task's status the menu changes; the pill's own status label names
              // the trigger.
              label={t('tasks.changeStatus', { title: task.title })}
            />
          </span>
        }
        notice={
          move.isError ? (
            <p className="text-caption text-destructive">{t('tasks.statusFailed')}</p>
          ) : null
        }
      />
    </div>
  )
}
