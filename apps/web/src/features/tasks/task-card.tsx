import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { dueDay, isOverdue } from './due-date.js'
import { isRaised, priorityPill } from './priority.js'

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
  onOpenTitle,
  locationName,
  ownTasks = false,
}: {
  task: Task
  grip?: ReactNode
  actions?: ReactNode
  statusControl?: ReactNode
  notice?: ReactNode
  // When the card opens something (the board's editor), the title becomes the keyboard's
  // route to it. Absent on the read-only cards, where the title is just a heading.
  onOpenTitle?: () => void
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
  const now = new Date()
  // Overdue is counted in whole LOCAL DAYS, not against the wall clock (due-date.ts). The card
  // used to compare instants, which called a task due at noon overdue by one o'clock — while
  // the same task read "Today" in the list view. One rule now, in one place, for both.
  const overdue = isOverdue(task.dueDate, task.status, now)
  // And it names the near days the way a shift talks about them, which is also what the list
  // does: Today and Tomorrow, the calendar date after that.
  const dueLabel = (iso: string) => {
    const day = dueDay(iso, now)
    // The list view says 'Today' under a column headed Due; a card has no such header, so it
    // says the whole phrase or the word is orphaned.
    if (day === 'today') return t('tasks.dueTodayLong')
    if (day === 'tomorrow') return t('tasks.dueTomorrowLong')
    return t('tasks.due', { date: formatDate(iso) })
  }
  const assigneeNames = task.assignees.map((assignee) => assignee.displayName)

  return (
    <article
      // Every card renders at full opacity, done included (owner call 2026-08-11): the status
      // pill and the tab the card sits under already carry that signal, and dimming read as the
      // card being disabled. No strikethrough either, which reads as harsh (principle 4).
      // The stack rhythm is the artifact's own (The Counter, 2026-08-14): 3px under the
      // title, 9px above the date line, 11px above the footer — margins on each block, not
      // a uniform gap, so the card tightens itself when a block is absent.
      // Hovering firms the card's own border rather than underlining its title (owner call
      // 2026-08-21). The underline said "link", which a card is not — you are not going
      // somewhere, you are opening the thing you are already looking at — and it moved the
      // title's baseline against everything else in the row.
      className={cn(
        'flex flex-col rounded-lg border border-border bg-card px-[15px] pt-[13px] pb-3 text-card-foreground shadow-sm',
        onOpenTitle && 'transition-colors hover:border-border-strong',
      )}
    >
      <div className="flex items-center gap-2">
        {/* The grip lifts above the title's card-wide overlay (board-task-card.tsx), or a drag
            started on the handle would land on the open-the-task target instead. */}
        {grip ? <span className="relative z-10 flex">{grip}</span> : null}
        {/* dir="auto" so an authored title lays out by its own script — a Hebrew title reads
            RTL inside an English UI and vice-versa — clamped to two lines so a long title
            never blows out the card. min-w-0 lets it shrink so the clamp engages. */}
        <h3
          dir="auto"
          // Body scale at the artifact's 1.35 line — the title leads the card through its
          // weight, not a size step (The Counter, 2026-08-14).
          className="line-clamp-2 min-w-0 text-body leading-[1.35] font-semibold text-foreground"
        >
          {/* A real button when the card opens something, so the keyboard has the same reach
              the pointer does; plain text when it does not, rather than a control that leads
              nowhere. */}
          {onOpenTitle ? (
            <button
              type="button"
              onClick={onOpenTitle}
              className="text-start after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {task.title}
            </button>
          ) : (
            task.title
          )}
        </h3>
        {/* One mark for a raised priority — the flag and the word on the priority's own soft
            ground (2026-08-21). Normal shows nothing: it is where every task starts, so marking
            it would put a badge on the whole board and tell a reader nothing. The flag is
            decorative; the pill's own label names the priority. */}
        {isRaised(task.priority) ? (
          <span
            className={cn(
              'inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold',
              priorityPill(task.priority),
            )}
          >
            <Icon name="priority" size="sm" active={task.priority === 'high'} />
            {t(taskPriorityLabelKey(task.priority))}
          </span>
        ) : null}
        {actions ? <span className="ms-auto flex">{actions}</span> : null}
      </div>

      {task.description ? (
        /* The whole description on the card (owner call 2026-08-12) — full width under the
           title row, keeping authored line breaks. dir="auto" for the same script-of-its-own
           reason as the title. */
        <p dir="auto" className="mt-[3px] whitespace-pre-line text-label text-muted-foreground">
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
        <p className="mt-[9px] flex items-center gap-1.5 text-caption text-status-done-foreground">
          <Icon name="status-done" size="sm" />
          {t('tasks.completed', { date: formatDate(task.completedAt) })}
        </p>
      ) : task.dueDate ? (
        <p
          className={cn(
            'mt-[9px] flex items-center gap-1.5 text-caption text-muted-foreground',
            overdue && 'font-semibold text-destructive-muted-foreground',
          )}
        >
          <Icon name={overdue ? 'overdue' : 'due-date'} size="sm" />
          {dueLabel(task.dueDate)}
        </p>
      ) : null}

      {/* The one footer row, split from the body by a hairline (The Counter, round 8): the
          branch chip (admin's chain-wide board only), then the audience — backlog chip or
          assignee stack on a manager/admin card — and the StatusControl at the inline-end.
          An own-tasks card carries the pill alone here beside its branch-less footer (the
          assignee stack is a manager/admin signal: an own-tasks board is all the viewer's
          tasks, #213). */}
      <div className="mt-[11px] flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-caption text-muted-foreground">
        {locationName ? (
          /* The branch as a quiet bordered pill led by the pin glyph (the artifact's bchip).
             dir="auto" keeps a Hebrew branch name reading as its own script. */
          <span
            dir="auto"
            className="inline-flex items-center gap-1 rounded-full border border-border-strong px-[9px] py-[2px] text-caption font-semibold text-muted-foreground"
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

      {notice ? <div className="mt-2">{notice}</div> : null}
    </article>
  )
}
