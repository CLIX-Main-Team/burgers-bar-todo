import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'

// The signature composition of the board (#213), recut to The Counter (round 8, 2026-08-14):
// title row, the description in full (owner call 2026-08-12 — the one-line teaser wasn't
// enough), the date on its own line, then ONE footer row split off by a hairline carrying the
// card's audience and control together — the branch chip (bordered pill with the pin glyph,
// admin's chain-wide board only), the assignee stack or backlog chip, and the StatusControl
// at the inline-end. The separate "Created by {name}" provenance line is retired with this
// recut (the artifact's card closes on the footer row); the status speaks only through the
// chip's dot and an overdue date's colour — the card edge stays quiet.
//
// The card is presentational: the caller supplies the interactive slots. `grip` is the drag
// handle (a manager/admin's full drag, or an employee's status-only lane move; absent when drag
// is off), placed at the inline-start — kept through the recut (owner call: the desktop grip
// stays). `actions` is the overflow DropdownMenu (Edit / Move to / Delete), the manager/admin
// write surface, at the title row's inline-end. `statusControl` is the StatusControl pill at
// the meta row's inline-end — the employee's sole write affordance (audit X5), and since the
// tabbed mobile board (owner decision 2026-08) also on a manager/admin card, where the single
// visible lane leaves no cross-lane drag to change status with. `ownTasks` marks a board where
// every card is the viewer's own (the employee read): the assignee stack is dropped as noise,
// leaving the pill alone in the meta row (the date rides its own line above it). `notice`
// carries a transient write error (a failed status move or delete) beneath the card.
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
      // card being disabled. No strikethrough either, which reads as harsh (principle 4). A
      // card with no description tightens its stack (owner feedback 2026-08-12) — the roomier
      // gap earns its place only when there's a paragraph to breathe around.
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm',
        task.description ? 'gap-2.5' : 'gap-2',
      )}
    >
      <div className="flex items-center gap-2">
        {grip}
        {/* dir="auto" so an authored title lays out by its own script — a Hebrew title reads
            RTL inside an English UI and vice-versa — clamped to two lines so a long title
            never blows out the card. min-w-0 lets it shrink so the clamp engages. */}
        <h3
          dir="auto"
          // 16px — a half-step over body (replica + owner's one-notch raise 2026-08-13),
          // so the title leads the card without jumping to a heading role.
          className="line-clamp-2 min-w-0 text-[1rem] leading-snug font-semibold text-foreground"
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

      {task.description ? (
        /* The whole description on the card (owner call 2026-08-12) — full width under the
           title row, keeping authored line breaks. dir="auto" for the same script-of-its-own
           reason as the title. */
        <p dir="auto" className="whitespace-pre-line text-label text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      {/* The date reads on its own line above the meta row (owner feedback 2026-08-12 — packed
          beside the backlog chip it wrapped the status pill onto a ragged second line): the
          completed time on a done card, else the due date, flipping to the destructive-soft
          foreground when overdue. */}
      {isDone && task.completedAt ? (
        /* The one place a status word wears its colour (design refresh 2026-08-12): the
           completed line reads in the done ink, the quiet green receipt on a finished card. */
        <p className="flex items-center gap-1.5 text-caption text-status-done-foreground">
          <Icon name="status-done" size="sm" />
          {t('tasks.completed', { date: formatDate(task.completedAt) })}
        </p>
      ) : task.dueDate ? (
        <p
          className={cn(
            'flex items-center gap-1.5 text-caption text-muted-foreground',
            isOverdue && 'font-semibold text-destructive-muted-foreground',
          )}
        >
          <Icon name={isOverdue ? 'overdue' : 'due-date'} size="sm" />
          {t('tasks.due', { date: formatDate(task.dueDate) })}
        </p>
      ) : null}

      {/* The one footer row, split from the body by a hairline (The Counter, round 8): the
          branch chip (admin's chain-wide board only), then the audience — backlog chip or
          assignee stack on a manager/admin card — and the StatusControl at the inline-end.
          An own-tasks card carries the pill alone here beside its branch-less footer (the
          assignee stack is a manager/admin signal: an own-tasks board is all the viewer's
          tasks, #213). */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-caption text-muted-foreground">
        {locationName ? (
          /* The branch as a quiet bordered pill led by the pin glyph (the artifact's bchip).
             dir="auto" keeps a Hebrew branch name reading as its own script. */
          <span
            dir="auto"
            className="inline-flex items-center gap-1 rounded-full border border-border-strong px-2 py-0.5 text-caption font-semibold text-muted-foreground"
          >
            <Icon name="location" size="sm" />
            {locationName}
          </span>
        ) : null}
        {/* A task with no assignees is the backlog (managers and admins only ever see it —
            the scope predicate keeps it off an employee's board). */}
        {ownTasks ? null : task.assignees.length === 0 ? (
          <Badge variant="muted">
            <Icon name="backlog" size="sm" />
            {t('tasks.backlog')}
          </Badge>
        ) : (
          <AvatarStack names={assigneeNames} label={t('tasks.assignedTo')} />
        )}
        {statusControl ? <span className="ms-auto flex">{statusControl}</span> : null}
      </div>

      {notice}
    </article>
  )
}
