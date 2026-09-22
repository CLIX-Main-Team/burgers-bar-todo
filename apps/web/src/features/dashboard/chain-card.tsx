import type { TaskPriority } from '@burgers/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { PillGroup } from '../../components/ui/pill-group.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { rowDelayStyle } from '../../lib/motion.js'
import { DashboardCard } from './dashboard-card.js'
import type { BranchHealth, PlaceRow, PriorityMix } from './dashboard-metrics.js'
import { Donut } from './status-donut.js'

// Across the chain: where the open work sits (round 3, 2026-09-22; the reference dashboards'
// "Team totals" card, two rings over a ranked list). The first ring reads every branch as behind,
// on track or clear, the one chain-wide health figure an owner of forty-six branches can take in
// at a glance; the second splits the open work by what it is worth. Under them, the places in
// trouble first, switchable between branches and departments.
//
// Only drawn for a viewer whose work spans more than one place: a branch manager has nothing to
// compare their branch against, and a ring of one branch is a single colour.

const ROWS = 6

const PRIORITY_STROKE: Record<TaskPriority, string> = {
  high: 'stroke-priority-high',
  medium: 'stroke-priority-medium',
  normal: 'stroke-priority-normal',
}
const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: 'bg-priority-high',
  medium: 'bg-priority-medium',
  normal: 'bg-priority-normal',
}

export interface ChainRow extends PlaceRow {
  /** What sits in the row's badge: a branch number, or a glyph for the head office or a department. */
  badge: { kind: 'number'; value: number } | { kind: 'icon'; icon: IconRole }
}

export function ChainCard({
  health,
  priorities,
  openTotal,
  branches,
  branchCount,
  departments,
  linkToLocations,
  delay,
  className,
}: {
  /** Null when the branch list is not readable, so "clear" branches cannot be counted. */
  health: BranchHealth | null
  priorities: PriorityMix[]
  openTotal: number
  branches: ChainRow[]
  branchCount: number
  /** Null when the viewer's work does not span departments. */
  departments: ChainRow[] | null
  linkToLocations: boolean
  delay: number
  className?: string
}) {
  const t = useTranslations()
  const [lens, setLens] = useState<'branches' | 'departments'>('branches')
  const showingDepartments = lens === 'departments' && departments !== null
  const rows = (showingDepartments ? departments : branches).slice(0, ROWS)
  const top = Math.max(1, ...rows.map((row) => row.open))

  return (
    <DashboardCard
      title={t('dashboard.chainTitle')}
      note={t('dashboard.chainNote')}
      delay={delay}
      className={className}
      action={
        departments !== null ? (
          <PillGroup
            label={t('dashboard.chainTitle')}
            value={lens}
            onChange={setLens}
            options={[
              { value: 'branches', label: t('dashboard.chainBranches') },
              { value: 'departments', label: t('dashboard.chainDepartments') },
            ]}
          />
        ) : null
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {health !== null ? (
          <Ring
            value={String(branchCount)}
            caption={t('dashboard.ringBranches')}
            segments={[
              { id: 'behind', value: health.behind, stroke: 'stroke-destructive' },
              { id: 'on-track', value: health.onTrack, stroke: 'stroke-status-in-progress-dot' },
              { id: 'clear', value: health.clear, stroke: 'stroke-status-done-dot' },
            ]}
            legend={[
              { label: t('dashboard.ringBehind'), dot: 'bg-destructive', count: health.behind },
              {
                label: t('dashboard.ringOnTrack'),
                dot: 'bg-status-in-progress-dot',
                count: health.onTrack,
              },
              { label: t('dashboard.ringClear'), dot: 'bg-status-done-dot', count: health.clear },
            ]}
          />
        ) : null}
        <Ring
          value={String(openTotal)}
          caption={t('dashboard.ringOpen')}
          segments={priorities.map((slice) => ({
            id: slice.priority,
            value: slice.count,
            stroke: PRIORITY_STROKE[slice.priority],
          }))}
          legend={priorities.map((slice) => ({
            label: t(taskPriorityLabelKey(slice.priority)),
            dot: PRIORITY_DOT[slice.priority],
            count: slice.count,
          }))}
        />
      </div>

      <div className="mt-6">
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_3rem_3.5rem] gap-3 border-b border-border pb-2 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
          <span>
            {showingDepartments ? t('dashboard.colDepartment') : t('dashboard.colBranch')}
          </span>
          <span />
          <span className="text-end">{t('dashboard.colOpen')}</span>
          <span className="text-end">{t('dashboard.colOverdue')}</span>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-label text-muted-foreground">
            {t('dashboard.chainEmpty')}
          </p>
        ) : (
          <ul>
            {rows.map((row, index) => (
              <li
                key={row.id}
                className="grid grid-cols-[minmax(0,1fr)_5.5rem_3rem_3.5rem] items-center gap-3 border-b border-border py-2.5 last:border-b-0 motion-safe:animate-settle"
                style={rowDelayStyle(delay + 200, index)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-grid h-7 min-w-7 flex-none place-items-center rounded-lg bg-muted px-1 text-caption font-bold tabular-nums text-muted-foreground">
                    {row.badge.kind === 'number' ? (
                      `#${row.badge.value}`
                    ) : (
                      <Icon name={row.badge.icon} size="sm" />
                    )}
                  </span>
                  <bdi className="min-w-0 truncate text-body font-semibold text-foreground">
                    {row.name}
                  </bdi>
                </span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-foreground/70"
                    style={{ width: `${(row.open / top) * 100}%` }}
                  />
                </span>
                <span className="text-end text-body font-bold tabular-nums text-foreground">
                  {row.open}
                </span>
                <span
                  className={cn(
                    'text-end text-body tabular-nums',
                    row.overdue > 0 ? 'font-bold text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {row.overdue}
                </span>
              </li>
            ))}
          </ul>
        )}
        {linkToLocations && !showingDepartments ? (
          <Link
            to="/locations"
            className="mt-4 inline-flex items-center gap-1.5 text-label font-semibold text-link underline-offset-4 hover:underline"
          >
            {t('dashboard.chainAll')}
            <Icon name="row-forward" size="sm" />
          </Link>
        ) : null}
      </div>
    </DashboardCard>
  )
}

// A ring beside its own legend. The legend is what keeps colour from being the only carrier
// (WCAG 1.4.1): every slice states its name and its count in words beside its swatch.
function Ring({
  value,
  caption,
  segments,
  legend,
}: {
  value: string
  caption: string
  segments: { id: string; value: number; stroke: string }[]
  legend: { label: string; dot: string; count: number }[]
}) {
  // The legend sits under its ring rather than beside it: two rings side by side leave each one
  // about half a card, and a legend squeezed beside a 108px ring truncated "On track" to "O…".
  return (
    <div className="flex flex-col items-center gap-3">
      <Donut segments={segments} value={value} caption={caption} />
      <ul className="flex w-full max-w-[13rem] flex-col gap-1.5">
        {legend.map((entry) => (
          <li
            key={entry.label}
            className="flex items-center gap-2 text-label text-muted-foreground"
          >
            <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', entry.dot)} />
            <span className="min-w-0 truncate">{entry.label}</span>
            <span className="ms-auto font-bold tabular-nums text-foreground">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
