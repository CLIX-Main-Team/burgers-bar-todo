import type { Task } from '@burgers/shared'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { TILE_SURFACE } from '../../components/ui/surfaces.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { dueDay, isOverdue } from './due-date.js'
import { PriorityMark } from './priority-mark.js'
import { isRaised } from './priority.js'

// The board's task, drawn as a tile sunk into its lane's card (Tasks redesign 2026-09-22, the
// Dashboard's house style: a card holding tiles reads as one surface, where a lane of white cards
// each with its own border and shadow read as a stack of forms). Three lines and nothing else:
//
//   the title, with the priority flag beside it when the task has been raised;
//   the facts: the due day (red once it is late) or the day a done task was finished, the
//   checklist count, and the branch on a chain-wide board, which truncates first;
//   the footer: who is on it, and the status control at the inline end.
//
// What came off in the redesign, and why:
//   - The row the grip and the flag used to share at the top. The grip now waits in the tile's
//     corner and shows itself to the pointer that finds the tile (and to the keyboard), so the
//     title is the first thing on every tile.
//   - The flag on an ordinary task. Normal is the floor every task starts at, so a grey flag on
//     every tile said nothing forty times over; only a raised priority is marked now, and the
//     list view still gives every task its priority in its own column.
//   - The hairline over the footer, and the branch's bordered pill: spacing does the first
//     one's job, and a pin beside the name is enough for the second.
//
// The tile is presentational: the caller supplies the interactive slots. `grip` is the drag
// handle (a manager/admin's full drag, or an employee's status-only lane move; absent when drag
// is off). `actions` is an optional control at the title's inline end. `statusControl` is the
// StatusControl pill at the footer's inline end, the employee's sole write and, on the tabbed
// phone board, everyone's way to move a task. Every tile carries its assignee signal, the
// employee's included (owner call 2026-09-22): a task is often two people's, and "who else is on
// this" is the one thing an employee's card could not say. `notice` carries a transient write
// error beneath the tile.
export function TaskCard({
  task,
  grip,
  actions,
  statusControl,
  notice,
  onOpenTitle,
  locationName,
}: {
  task: Task
  grip?: ReactNode
  actions?: ReactNode
  statusControl?: ReactNode
  notice?: ReactNode
  // When the tile opens something (the editor, or the read-only sheet), the title becomes the
  // keyboard's route to it. Absent where the title is just a heading.
  onOpenTitle?: () => void
  // The task's branch name, supplied only on an admin's chain-wide board — the one viewer whose
  // lanes mix every location's tasks, so each tile must say which board it belongs to.
  locationName?: string
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

  const isDone = task.status === 'done'
  const now = new Date()
  // Overdue is counted in whole LOCAL DAYS, not against the wall clock (due-date.ts), the same
  // rule the list view uses, so a task due at noon is not late by one o'clock.
  const overdue = isOverdue(task.dueDate, task.status, now)
  // The near days are named the way a shift talks about them: Today and Tomorrow, the calendar
  // date after that. A tile has no column head saying "Due", so it says the whole phrase.
  const dueLabel = (iso: string) => {
    const day = dueDay(iso, now)
    if (day === 'today') return t('tasks.dueTodayLong')
    if (day === 'tomorrow') return t('tasks.dueTomorrowLong')
    return t('tasks.due', { date: formatDate(iso) })
  }
  const checklistDone = task.checklist.filter((item) => item.done).length
  const showFacts =
    (isDone && Boolean(task.completedAt)) ||
    Boolean(task.dueDate) ||
    task.checklist.length > 0 ||
    Boolean(locationName)

  return (
    <article
      // Every tile renders at full strength, done included (owner call 2026-08-11): the lane and
      // the status control already say it is finished, and dimming read as disabled. The hover
      // is a ring rather than a darker ground, since the sunken tone is the muted one in the
      // dark theme and a darker fill would vanish there.
      className={cn(
        TILE_SURFACE,
        'group/tile relative flex flex-col ps-4.5 pe-3.5 pt-3 pb-2 text-card-foreground',
        onOpenTitle && 'transition-shadow hover:ring-1 hover:ring-inset hover:ring-border-strong',
      )}
    >
      {/* The grip waits in the tile's top inline-start corner, inside the padding the title
          already leaves, and lifts above the title's tile-wide overlay (or a drag started on it
          would open the task instead). */}
      {grip ? <span className="absolute top-2 start-0.5 z-10 flex">{grip}</span> : null}

      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-body leading-[1.35] font-semibold text-foreground">
          {/* dir="auto" so an authored title lays out by its own script, on the title itself and
              sized to it (w-fit): on the full-width heading a Hebrew title in the English UI
              flushed to the far edge, away from the date and the faces under it. Clamped to two
              lines so a long one never blows the tile out.

              A real button when the tile opens something, so the keyboard has the same reach the
              pointer does; plain text when it does not. Its ::after stretches over the whole
              tile, so the pointer gets the whole surface. */}
          {onOpenTitle ? (
            <button
              type="button"
              dir="auto"
              onClick={onOpenTitle}
              className="line-clamp-2 w-fit max-w-full text-start after:absolute after:inset-0 after:rounded-[0.875rem] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {task.title}
            </button>
          ) : (
            <span dir="auto" className="line-clamp-2 w-fit max-w-full">
              {task.title}
            </span>
          )}
        </h3>
        {/* z-10 so the flag's tooltip gets the hover the title's overlay would otherwise take. */}
        {isRaised(task.priority) ? (
          <PriorityMark priority={task.priority} className="z-10 -me-1 -mt-0.5" />
        ) : null}
        {actions ? <span className="relative z-10 flex">{actions}</span> : null}
      </div>

      {/* The facts line. The one date a tile carries comes first: when a done task was
          finished, in the done ink, else when it is due, in the destructive ink once that day
          has passed. Then the checklist count, then the branch on the admin's chain-wide board,
          the one thing on the line allowed to give way when the lane is narrow. */}
      {showFacts ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-x-3 text-caption text-muted-foreground">
          {isDone && task.completedAt ? (
            <span className="inline-flex flex-none items-center gap-1.5 text-status-done-foreground">
              <Icon name="status-done" size="sm" />
              {t('tasks.completed', { date: formatDate(task.completedAt) })}
            </span>
          ) : task.dueDate ? (
            <span
              className={cn(
                'inline-flex flex-none items-center gap-1.5',
                overdue && 'font-semibold text-destructive-muted-foreground',
              )}
            >
              <Icon name={overdue ? 'overdue' : 'due-date'} size="sm" />
              {dueLabel(task.dueDate)}
            </span>
          ) : null}
          {/* Checklist progress: the count alone, no bar (2026-08-26). */}
          {task.checklist.length > 0 ? (
            <span className="inline-flex flex-none items-center gap-1 tabular-nums">
              <Icon name="selected" size="sm" />
              {t('tasks.checklistCount', { done: checklistDone, total: task.checklist.length })}
            </span>
          ) : null}
          {/* dir="auto" on the NAME, not the line, so a Hebrew branch lays out by its own
              script without moving the pin. */}
          {locationName ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Icon name="location" size="sm" className="flex-none" />
              <span dir="auto" className="truncate">
                {locationName}
              </span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
        {/* A task with no assignees is the backlog: a state a manager acts on, so it is named
            rather than left as an empty slot. */}
        {task.assignees.length === 0 ? (
          <span className="inline-flex flex-none items-center gap-1 rounded-md bg-card px-2 py-0.5 font-semibold">
            <Icon name="backlog" size="sm" />
            {t('tasks.backlog')}
          </span>
        ) : (
          <AvatarStack
            people={task.assignees}
            label={t('tasks.assignedTo')}
            ring="ring-surface-sunken"
            className="flex-none"
          />
        )}
        {statusControl ? <span className="ms-auto flex flex-none">{statusControl}</span> : null}
      </div>

      {notice ? <div className="mt-1 pb-1">{notice}</div> : null}
    </article>
  )
}
