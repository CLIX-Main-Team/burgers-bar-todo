import type { TaskSubject } from '@burgers/shared'
import { type ReactNode, useId } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { CARD_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'
import { useDepartmentName, useDepartments } from '../departments/use-departments.js'
import { StatePanel } from './board-states.js'
import { SubjectPlacePill, subjectFill } from './subject-card.js'
import { TicketSpike } from './ticket-spike.js'

// The head of one subject's board (owner ask 2026-09-20; redrawn in the Tasks redesign
// 2026-09-22 as a card in the Dashboard's house style). Above it, the way back to its
// department. In it: the subject's colour and name where the page title would be, whose it is
// (the place pill, owner ask 2026-09-22: inside a chain-wide subject the owner saw tasks from two
// branches and took it for a bug), its line of description, and the counts over the rows this
// viewer sees, led by the open figure and the two parts of it that ask for something today.
//
// The card's one picture is the ticket spike at its inline end (ticket-spike.tsx): the subject's
// finished work, piled on the pin by the pass the way a kitchen keeps its done tickets. It sits
// behind the text and takes a share of the card, so on a phone it shrinks rather than reaching
// the name.
export function SubjectHeader({
  subject,
  open,
  done,
  overdue,
  dueToday,
  delay,
  action,
}: {
  subject: TaskSubject
  open: number
  done: number
  overdue: number
  dueToday: number
  /** The card's place in the page's entrance, in ms; the spike's pile follows it. */
  delay: number
  /** New task, at the inline end of the back link's row: where the top levels keep it too. */
  action?: ReactNode
}) {
  const t = useTranslations()
  const departmentName = useDepartmentName()(subject.departmentId)
  const slug = useDepartments().data?.find((d) => d.id === subject.departmentId)?.slug
  const back = slug ? `/tasks?department=${encodeURIComponent(slug)}` : '/tasks'
  const titleId = useId()

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <Link
          to={back}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-label font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="back" size="sm" className="flex-none" />
          <span dir="auto">
            {departmentName
              ? t('tasks.backToDepartment', { department: departmentName })
              : t('tasks.backToTasks')}
          </span>
        </Link>
        {action}
      </div>

      <section
        className={cn(
          CARD_SURFACE,
          'relative isolate flex min-h-[10.5rem] flex-col justify-between gap-5 overflow-hidden p-5 md:px-6',
        )}
        aria-labelledby={titleId}
      >
        {/* Standing on the card's floor at the inline end, a fixed height so every subject's
            pin is the same length and only the pile changes. */}
        <TicketSpike
          done={done}
          total={open + done}
          delay={delay}
          className="pointer-events-none absolute -z-10 end-4 bottom-3 h-[7.25rem] w-auto md:end-10 md:h-[8.5rem]"
        />

        <div className="flex min-w-0 flex-col pe-24 md:pe-40">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span
              aria-hidden="true"
              className={cn('size-3 flex-none rounded-[4px]', subjectFill(subject))}
            />
            <h1
              id={titleId}
              dir="auto"
              className="min-w-0 truncate text-heading-lg font-extrabold text-foreground"
            >
              {subject.name}
            </h1>
            <SubjectPlacePill subject={subject} />
          </div>
          {subject.description ? (
            <p dir="auto" className="mt-1 line-clamp-2 text-label text-muted-foreground">
              {subject.description}
            </p>
          ) : null}

          {/* The open figure leads, at the Dashboard's figure size: it is the number that changes
              what somebody does today. The chips beside it are the two parts of it that ask for
              something now, in the tones those states wear everywhere else; the done count
              follows quietly, since the spike already draws it. */}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pe-24 md:pe-40">
          <p className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-figure-lg font-bold text-foreground">{open}</span>
            <span className="text-label font-semibold text-muted-foreground">
              {t('tasks.subjectOpenLabel', { count: open })}
            </span>
          </p>
          {overdue > 0 ? (
            <span className="rounded-full bg-destructive-muted px-2.5 py-0.5 text-label font-semibold tabular-nums text-destructive-muted-foreground">
              {t('tasks.subjectOverdue', { count: overdue })}
            </span>
          ) : null}
          {dueToday > 0 ? (
            <span className="rounded-full bg-warning-muted px-2.5 py-0.5 text-label font-semibold tabular-nums text-warning-muted-foreground">
              {t('tasks.subjectDueToday', { count: dueToday })}
            </span>
          ) : null}
          <span className="text-label tabular-nums text-muted-foreground">
            {t('tasks.subjectDone', { count: done })}
          </span>
        </div>
      </section>
    </div>
  )
}

// The subject is gone, or belongs to a department this viewer cannot see: one answer for both,
// the way the API gives one, with the way back.
export function SubjectNotFound() {
  const t = useTranslations()
  return (
    <StatePanel
      framed
      icon="board-empty"
      title={t('tasks.subjectNotFound')}
      body={t('tasks.subjectNotFoundHint')}
      action={
        <Link
          to="/tasks"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong bg-card px-3 text-caption font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="back" size="sm" />
          {t('tasks.backToTasks')}
        </Link>
      }
    />
  )
}
