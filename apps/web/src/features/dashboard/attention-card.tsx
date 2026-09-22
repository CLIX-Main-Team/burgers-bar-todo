import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { rowDelayStyle } from '../../lib/motion.js'
import { daysUntil, dueDay } from '../tasks/due-date.js'
import { isRaised, priorityPill } from '../tasks/priority.js'
import type { SharedTask } from '../tasks/task-filters.js'
import { DashboardCard, PillGroup } from './dashboard-card.js'
import type { Attention } from './dashboard-metrics.js'

// Needs attention: the short lists to chase, one tab each for late work, today's work and the
// high-priority work still open (round 3, 2026-09-22). It replaces round 11's paginated task
// table. The board is where the full list lives and where work is written; this card is the
// handful a manager acts on first, and it ends with the way to the board.

type Lens = keyof Attention

const ROWS = 6

export function AttentionCard({
  attention,
  placeNames,
  subjectNames,
  now,
  delay,
  className,
}: {
  attention: Attention
  placeNames: Map<string, string>
  subjectNames: Map<string, string>
  now: Date
  delay: number
  className?: string
}) {
  const t = useTranslations()
  // Opens on the first list with something in it, so the card never greets the reader with an
  // empty tab while another one is full.
  const firstFull: Lens =
    attention.overdue.length > 0 ? 'overdue' : attention.dueToday.length > 0 ? 'dueToday' : 'high'
  const [chosen, setChosen] = useState<Lens | null>(null)
  const lens = chosen ?? firstFull
  const list = attention[lens]
  const shown = list.slice(0, ROWS)
  const hidden = list.length - shown.length

  const empty: Record<Lens, string> = {
    overdue: t('dashboard.attentionEmptyOverdue'),
    dueToday: t('dashboard.attentionEmptyToday'),
    high: t('dashboard.attentionEmptyHigh'),
  }

  return (
    <DashboardCard
      title={t('dashboard.attentionTitle')}
      note={t('dashboard.attentionNote')}
      delay={delay}
      className={className}
    >
      <PillGroup
        label={t('dashboard.attentionTitle')}
        value={lens}
        onChange={setChosen}
        options={[
          {
            value: 'overdue',
            label: t('dashboard.attentionOverdue'),
            count: attention.overdue.length,
          },
          {
            value: 'dueToday',
            label: t('dashboard.attentionToday'),
            count: attention.dueToday.length,
          },
          { value: 'high', label: t('dashboard.attentionHigh'), count: attention.high.length },
        ]}
      />

      {shown.length === 0 ? (
        <p className="mt-4 flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface-sunken px-4 py-8 text-label text-muted-foreground">
          <Icon name="status-done" size="sm" />
          {empty[lens]}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {shown.map((task, index) => (
            <Row
              key={task.id}
              task={task}
              lens={lens}
              place={placeNames.get(task.locationId)}
              subject={task.subjectId ? subjectNames.get(task.subjectId) : undefined}
              now={now}
              delay={delay}
              index={index}
            />
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4">
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1.5 text-label font-semibold text-link underline-offset-4 hover:underline"
        >
          {t('dashboard.openBoard')}
          <Icon name="row-forward" size="sm" />
        </Link>
        {hidden > 0 ? (
          <span className="text-caption text-muted-foreground">
            {t('dashboard.attentionMore', { count: hidden })}
          </span>
        ) : null}
      </div>
    </DashboardCard>
  )
}

function Row({
  task,
  lens,
  place,
  subject,
  now,
  delay,
  index,
}: {
  task: SharedTask
  lens: Lens
  place: string | undefined
  subject: string | undefined
  now: Date
  delay: number
  index: number
}) {
  const t = useTranslations()
  const meta = [place, subject].filter((part): part is string => Boolean(part))

  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border py-3 last:border-b-0 motion-safe:animate-settle"
      style={rowDelayStyle(delay + 180, index)}
    >
      {/* items-start and shrink-wrapped lines: a Hebrew title under dir=auto must hug the row's
          start exactly as an English one does, never the far edge (round 11's lesson). */}
      <div className="flex min-w-0 flex-col items-start">
        <bdi className="max-w-full truncate text-body font-semibold text-foreground">
          {task.title}
        </bdi>
        {meta.length > 0 ? (
          <p className="max-w-full truncate text-caption text-muted-foreground">
            {meta.map((part, partIndex) => (
              <span key={part}>
                {partIndex > 0 ? ' · ' : null}
                <bdi>{part}</bdi>
              </span>
            ))}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {/* In the High tab every row is high, so the pill would only repeat the tab's name. */}
        {lens !== 'high' && isRaised(task.priority) ? (
          <span
            className={cn(
              'hidden items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold whitespace-nowrap sm:inline-flex',
              priorityPill(task.priority),
            )}
          >
            <Icon name="priority" size="sm" active={task.priority === 'high'} />
            {t(taskPriorityLabelKey(task.priority))}
          </span>
        ) : null}
        {task.assignees.length > 0 ? (
          <AvatarStack
            people={task.assignees}
            label={t('tasks.assignedTo')}
            max={2}
            overflowLabel={t('locations.morePeople', {
              count: Math.max(task.assignees.length - 2, 0),
            })}
          />
        ) : null}
        <DueLabel task={task} now={now} />
      </div>
    </li>
  )
}

// How the due date reads in this card: late work by how late, today's by the word, anything
// further out by its day. Late is the destructive ink and today the warning ink, the same pair
// the overview tiles and the hero use for the same two facts.
function DueLabel({ task, now }: { task: SharedTask; now: Date }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const base = 'min-w-[5.5rem] text-end text-caption whitespace-nowrap tabular-nums'
  if (!task.dueDate) {
    return (
      <span aria-hidden="true" className={cn(base, 'text-border-strong')}>
        —
      </span>
    )
  }
  const days = daysUntil(task.dueDate, now)
  if (days < 0) {
    return (
      <span className={cn(base, 'font-bold text-destructive')}>
        {t('dashboard.daysLate', { days: -days })}
      </span>
    )
  }
  const day = dueDay(task.dueDate, now)
  if (day === 'today') {
    return (
      <span className={cn(base, 'font-bold text-warning-muted-foreground')}>
        {t('tasks.dueToday')}
      </span>
    )
  }
  return (
    <span className={cn(base, 'text-muted-foreground')}>
      {day === 'tomorrow'
        ? t('tasks.dueTomorrow')
        : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
            new Date(task.dueDate),
          )}
    </span>
  )
}
