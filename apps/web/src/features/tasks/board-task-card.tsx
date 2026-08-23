import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { StatusControl } from '../../components/ui/status-control.js'
import { TaskCard } from './task-card.js'
import { useTaskStatusMutation } from './task-menu.js'

// A writer's board card (v2 handoff §4: "plain TaskCard, whole card clickable → modal, with
// inline StatusControl"). It replaces the ManagedTaskCard's three-dot overflow menu, which
// carried Edit, Move to… and Delete — every one of which now has a plainer home: the card
// itself opens the editor, the StatusControl pill in the meta row is the status change, and
// Delete lives in the editor beside Save, where a destructive action is read rather than
// hit by accident.
//
// The card's own title is the control that opens the editor, stretched over the whole card by
// its ::after — so the pointer gets the whole card and the keyboard gets one focusable target.
// The pill lifts above that overlay, so setting a status never also opens the editor behind it.
// The API stays the sole authority on both writes (ADR-0007).
export function BoardTaskCard({
  task,
  onOpen,
  grip,
  locationName,
}: {
  task: Task
  // Open the shared editor for this task; owned by the screen.
  onOpen: (task: Task) => void
  // The drag handle, supplied by the reorder surface; absent when drag is off.
  grip?: ReactNode
  // The task's branch name for the card chip — supplied only on an admin's chain-wide board.
  locationName?: string
}) {
  const t = useTranslations()
  const move = useTaskStatusMutation(task.id)

  return (
    <div className="relative">
      <TaskCard
        task={task}
        grip={grip}
        locationName={locationName}
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
