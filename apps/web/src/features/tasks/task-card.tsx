import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'

// The signature composition of the board (#213, task-board mockup §TaskCard, components.md
// §TaskCard), tuned for the kanban lane it will sit in. Title-led and title-only — no
// description preview, which lives in the edit sheet — so cards stay short and the board reads
// calm at a scan. The status chip is gone: the lane names the status (Slice B), and until the
// lanes land a done card is the one status the card still shows on its own (dimmed, with its
// completed time). Every field the read carries still renders somewhere — title, priority
// (high/low badge), due/overdue or completed time, assignees or the backlog — just recomposed.
//
// The card is presentational: the caller supplies the interactive slots. `grip` is the drag
// handle (a manager/admin's full drag, or an employee's status-only lane move; absent when drag
// is off), placed at the inline-start. `actions` is the overflow DropdownMenu (Edit / Move to /
// Delete), the manager/admin write surface, placed at the inline-end. `statusControl` is the
// employee's StatusControl pill: their no-pointer move affordance, placed at the meta-row
// inline-start — where a manager relies on the lane and the overflow "Move to…", an employee
// drags between lanes or moves the task with the
// pill (audit X5). When it is present the card is an employee's own task, so the assignee stack
// is dropped (every task here is the viewer's) and the due date takes the meta row's inline-end
// alone. `notice` carries a transient write error (a failed status move or delete) beneath the
// card.
export function TaskCard({
  task,
  grip,
  actions,
  statusControl,
  notice,
  locationName,
}: {
  task: Task
  grip?: ReactNode
  actions?: ReactNode
  statusControl?: ReactNode
  notice?: ReactNode
  // The task's branch name, supplied only on an admin's chain-wide board — the one viewer whose
  // lanes mix every location's tasks, so each card must say which board it belongs to. A manager
  // or employee only ever sees their own location and passes nothing.
  locationName?: string
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

  const isDone = task.status === 'done'
  // Overdue is a live comparison against the wall clock, and never applies to a done task —
  // a finished task is finished, not late. The card flips the due line to the destructive-soft
  // foreground and the `clock` glyph when a task is past its due date and still open.
  const isOverdue =
    !isDone && task.dueDate !== null && new Date(task.dueDate).getTime() < Date.now()
  const assigneeNames = task.assignees.map((assignee) => assignee.displayName)

  return (
    <article
      // Done dims the whole card to ~55–60% opacity (spec) — status column membership carries
      // the rest of the signal — with no strikethrough, which reads as harsh (principle 4).
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm',
        isDone && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        {grip}
        {/* dir="auto" so an authored title lays out by its own script — a Hebrew title reads
            RTL inside an English UI and vice-versa — clamped to two lines so a long title never
            blows out the card. min-w-0 lets it shrink so the clamp engages. */}
        <h3
          dir="auto"
          className="line-clamp-2 min-w-0 text-heading-sm font-semibold text-foreground"
        >
          {task.title}
        </h3>
        {/* High leads with the `warning` glyph so the most urgent cards stand out at a scan;
            low is a neutral muted chip; normal shows nothing (the implicit default, to cut
            board noise). The glyph is decorative — the chip's own label names the priority. */}
        {task.priority === 'high' ? (
          <Badge variant="warning">
            <Icon name="priority-high" size="sm" />
            {t(taskPriorityLabelKey('high'))}
          </Badge>
        ) : task.priority === 'low' ? (
          <Badge variant="muted">{t(taskPriorityLabelKey('low'))}</Badge>
        ) : null}
        {actions ? <span className="ms-auto flex">{actions}</span> : null}
      </div>

      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        {/* The employee's StatusControl leads the row; with it present the due date is pushed to
            the inline-end (below), so the pill names where the task sits and the date names when
            it is owed with the space between them. On a manager card there is no pill and the due
            date keeps the inline-start. */}
        {statusControl}
        {/* The branch chip leads an admin's meta row: their lanes mix every location's tasks, so
            the card names its board. dir="auto" so a Hebrew branch name reads RTL in an English
            UI and the reverse. */}
        {locationName ? (
          <Badge variant="muted" dir="auto">
            <Icon name="manage-locations" size="sm" />
            {locationName}
          </Badge>
        ) : null}
        {isDone && task.completedAt ? (
          <span className={cn('inline-flex items-center gap-1', statusControl && 'ms-auto')}>
            <Icon name="status-done" size="sm" />
            {t('tasks.completed', { date: formatDate(task.completedAt) })}
          </span>
        ) : task.dueDate ? (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              statusControl && 'ms-auto',
              isOverdue && 'font-semibold text-destructive-muted-foreground',
            )}
          >
            <Icon name={isOverdue ? 'overdue' : 'due-date'} size="sm" />
            {t('tasks.due', { date: formatDate(task.dueDate) })}
          </span>
        ) : null}

        {/* The assignee stack is a manager/admin signal only — an employee's board is all their
            own tasks, so the StatusControl card spends the inline-end on the due date instead. */}
        {statusControl ? null : task.assignees.length === 0 ? (
          // A task with no assignees is the backlog (managers and admins only ever see it —
          // the scope predicate keeps it off an employee's board). The chip stands in place of
          // the assignee stack, pushed to the inline-end.
          <Badge variant="warning" className="ms-auto">
            <Icon name="backlog" size="sm" />
            {t('tasks.backlog')}
          </Badge>
        ) : (
          <AvatarStack names={assigneeNames} label={t('tasks.assignedTo')} className="ms-auto" />
        )}
      </div>

      {notice}
    </article>
  )
}
