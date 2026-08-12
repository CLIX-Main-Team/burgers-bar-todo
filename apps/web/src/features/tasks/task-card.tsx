import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_TONE } from './board-columns.js'

// The signature composition of the board (#213, task-board mockup §TaskCard, components.md
// §TaskCard), recut person-led in the 2026-08-12 restyle: the card leads with a status-tinted
// squircle tile carrying the creator's initials — who handed you this task — captioned "Created
// by" under the title, so every card names its origin at a glance and the tile's soft tone
// (orange/blue/green, STATUS_TONE) restates the lane without a chip. A one-line description
// preview joins when the task has one (the full text still lives in the edit sheet). Every
// field the read carries still renders somewhere — title, priority (high/low badge), creator,
// due/overdue or completed time, assignees or the backlog — just recomposed.
//
// The card is presentational: the caller supplies the interactive slots. `grip` is the drag
// handle (a manager/admin's full drag, or an employee's status-only lane move; absent when drag
// is off), placed at the inline-start. `actions` is the overflow DropdownMenu (Edit / Move to /
// Delete), the manager/admin write surface, placed at the inline-end. `statusControl` is the
// StatusControl pill at the meta-row inline-start — the employee's sole write affordance (audit
// X5), and since the tabbed mobile board (owner decision 2026-08) also on a manager/admin card,
// where the single visible lane leaves no cross-lane drag to change status with. `ownTasks`
// marks a board where every card is the viewer's own (the employee read): the assignee stack is
// dropped as noise and the due date takes the meta row's inline-end alone — it rides its own
// prop rather than the pill's presence, now that the pill is on every card. `notice` carries a
// transient write error (a failed status move or delete) beneath the card.
export function TaskCard({
  task,
  grip,
  actions,
  statusControl,
  notice,
  locationName,
  ownTasks = false,
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
  ownTasks?: boolean
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
      // Every card renders at full opacity, done included (owner call 2026-08-11): the status
      // pill and the tab the card sits under already carry that signal, and dimming read as the
      // card being disabled. No strikethrough either, which reads as harsh (principle 4).
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <div className="flex items-start gap-3">
        {/* The grip centres against the creator tile's 44px band (h-11, matching the tile),
            not the whole row — a teaser line below must not drag the dots down with it. */}
        {grip ? <span className="flex h-11 items-center">{grip}</span> : null}
        {/* The creator tile: the initials of whoever assigned the task, on the status's soft
            tone — a squircle, not the assignee stack's circle, so origin and audience never
            read as the same mark. Decorative (aria-hidden inside Avatar); the caption below
            the title names the person for every reader. */}
        <Avatar
          name={task.createdBy.displayName}
          className={cn('size-11 shrink-0 rounded-2xl text-sm', STATUS_TONE[task.status])}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            {/* dir="auto" so an authored title lays out by its own script — a Hebrew title reads
                RTL inside an English UI and vice-versa — clamped to two lines so a long title
                never blows out the card. min-w-0 lets it shrink so the clamp engages. */}
            <h3 dir="auto" className="line-clamp-2 min-w-0 text-body font-semibold text-foreground">
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
          <p className="text-caption text-muted-foreground">
            {t('tasks.createdBy', { name: task.createdBy.displayName })}
          </p>
          {task.description ? (
            /* One authored line as a teaser — the sheet keeps the full text. dir="auto" for the
               same script-of-its-own reason as the title. */
            <p dir="auto" className="line-clamp-1 text-caption text-muted-foreground">
              {task.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* flex-wrap: with the pill on every card the row can outgrow a desktop lane (~315px), so
          the trailing chips wrap to a second line instead of bleeding past the card edge. */}
      <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        {/* The StatusControl pill leads the row on every card. On an own-tasks board the due date
            is pushed to the inline-end (below), so the pill names where the task sits and the date
            names when it is owed with the space between them; on a manager/admin card the assignee
            stack (or backlog chip) holds the inline-end instead and the date reads inline. */}
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
          <span className={cn('inline-flex items-center gap-1', ownTasks && 'ms-auto')}>
            <Icon name="status-done" size="sm" />
            {t('tasks.completed', { date: formatDate(task.completedAt) })}
          </span>
        ) : task.dueDate ? (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              ownTasks && 'ms-auto',
              isOverdue && 'font-semibold text-destructive-muted-foreground',
            )}
          >
            <Icon name={isOverdue ? 'overdue' : 'due-date'} size="sm" />
            {t('tasks.due', { date: formatDate(task.dueDate) })}
          </span>
        ) : null}

        {/* The assignee stack is a manager/admin signal only — an own-tasks board is all the
            viewer's tasks, so it spends the inline-end on the due date instead. */}
        {ownTasks ? null : task.assignees.length === 0 ? (
          // A task with no assignees is the backlog (managers and admins only ever see it —
          // the scope predicate keeps it off an employee's board). The chip stands in place of
          // the assignee stack, pushed to the inline-end. Neutral muted since the owner's
          // 2026-08 swap: the warm orange moved to the not-started status.
          <Badge variant="muted" className="ms-auto">
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
