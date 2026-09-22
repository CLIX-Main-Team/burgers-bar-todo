import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Avatar } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { rowDelayStyle } from '../../lib/motion.js'
import { DashboardCard, Legend } from './dashboard-card.js'
import type { PersonWorkload } from './dashboard-metrics.js'

// Team workload: each person's open work as one stacked bar, late work first (round 3,
// 2026-09-22; the reference dashboards' "open tasks per employee"). The three parts partition the
// bar, so its length is the person's real open count and a late task is never counted twice.
//
// Eight rows, because the card sits beside the activity chart and should end where it ends; the
// rest are counted on the card's face, never silently dropped, and the search finds anyone.

const SHOWN = 8

export function WorkloadCard({
  people,
  delay,
  className,
}: {
  people: PersonWorkload[]
  delay: number
  className?: string
}) {
  const t = useTranslations()
  const [query, setQuery] = useState('')
  const term = query.trim().toLowerCase()
  const matches = term
    ? people.filter((person) => person.name.toLowerCase().includes(term))
    : people
  const shown = matches.slice(0, SHOWN)
  const hidden = matches.length - shown.length
  // Bars are read against the busiest person on screen, so the longest bar is always full width
  // and every other one is a true fraction of it.
  const peak = Math.max(1, ...shown.map((person) => person.open))

  return (
    <DashboardCard
      title={t('dashboard.workloadTitle')}
      note={t('dashboard.workloadNote')}
      delay={delay}
      className={className}
      action={
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
            <Icon name="search" size="sm" />
          </span>
          <Input
            type="search"
            aria-label={t('dashboard.workloadSearch')}
            placeholder={t('dashboard.workloadSearch')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-9 w-[12.5rem] rounded-full ps-9 text-label md:text-label"
          />
        </div>
      }
    >
      <Legend
        items={[
          { label: t('dashboard.workloadOverdue'), swatch: 'bg-destructive' },
          { label: t(taskStatusLabelKey('not_started')), swatch: 'bg-status-not-started-dot' },
          { label: t(taskStatusLabelKey('in_progress')), swatch: 'bg-status-in-progress-dot' },
        ]}
      />

      {shown.length === 0 ? (
        <p className="mt-6 rounded-lg bg-surface-sunken px-4 py-6 text-center text-label text-muted-foreground">
          {people.length === 0 ? t('dashboard.workloadEmpty') : t('dashboard.workloadNoMatch')}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {shown.map((person, index) => (
            <li
              key={person.userId}
              className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_2rem] items-center gap-3"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={person.name} tone={person.avatarTone} className="size-6 flex-none" />
                <bdi className="min-w-0 truncate text-body font-semibold text-foreground">
                  {person.name}
                </bdi>
              </span>
              <span className="sr-only">
                {t('dashboard.workloadRow', {
                  name: person.name,
                  open: person.open,
                  overdue: person.overdue,
                  todo: person.todo,
                  inProgress: person.inProgress,
                })}
              </span>
              <span aria-hidden="true" className="flex h-5 overflow-hidden rounded-md bg-muted">
                {/* The fill sweeps in as ONE piece, so every frame of the entrance is a true
                    prefix of the finished bar (round 12's lesson: segments scaled one by one read
                    as three bars). A 2px gap of the track separates the parts. */}
                <span
                  className="bb-grow-origin-start flex h-full gap-[2px] motion-safe:animate-sweep-x"
                  style={{
                    width: `${(person.open / peak) * 100}%`,
                    ...rowDelayStyle(delay + 160, index),
                  }}
                >
                  <Part value={person.overdue} className="bg-destructive" />
                  <Part value={person.todo} className="bg-status-not-started-dot" />
                  <Part value={person.inProgress} className="bg-status-in-progress-dot" />
                </span>
              </span>
              <span className="text-end text-body font-bold tabular-nums text-foreground">
                {person.open}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 ? (
        <p className="mt-4 text-caption text-muted-foreground">
          {t('dashboard.workloadMore', { count: hidden })}
        </p>
      ) : null}
    </DashboardCard>
  )
}

// A zero part is dropped rather than drawn as a sliver nobody can measure. flex-grow over a zero
// basis splits the fill in proportion to the values, and the 2px gaps come out of the whole
// rather than pushing the last part past the end of the bar.
function Part({ value, className }: { value: number; className: string }) {
  if (value === 0) return null
  return <span className={cn('h-full', className)} style={{ flexGrow: value, flexBasis: 0 }} />
}
