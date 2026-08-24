import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import type { ShiftMetrics } from '../dashboard/dashboard-metrics.js'

// The branch's KPI row: the same four-across tile the Locations list and the Dashboard both
// wear, counting one branch instead of the chain. Three of the four numbers come straight
// out of `shiftMetrics` over this branch's slice of the board — the very functions the
// Dashboard reads — so the two screens cannot disagree about a number.
//
// Overdue is the only tile allowed colour, and only when it is not zero. With 40 to 50
// branches coming, "which branch needs me" is the question this surface answers, and a page
// where four numbers all shout answers nothing. The clock beside it keeps the alarm from
// being carried by colour alone (WCAG 1.4.1).
export function BranchTiles({ people, metrics }: { people: number; metrics: ShiftMetrics }) {
  const t = useTranslations()
  return (
    <div className="flex flex-wrap gap-3">
      <StatTile value={String(people)} label={t('locations.statPeople')} />
      <StatTile value={String(metrics.open)} label={t('locations.statOpenTasks')} />
      <StatTile
        value={String(metrics.overdue)}
        label={t('locations.statOverdue')}
        alert={metrics.overdue > 0}
      />
      <StatTile value={`${metrics.percentDone}%`} label={t('locations.statPercentDone')} />
    </div>
  )
}

// One number over its label. Drawn to the dimensions the Locations list and the Dashboard
// already use — a fourth shared component for twelve lines would be an abstraction over
// three screens that are free to drift, and the two existing copies say the same.
function StatTile({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]">
      <p
        className={cn(
          'flex items-center gap-1.5 text-display leading-tight font-bold tabular-nums',
          alert ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
        {alert ? <Icon name="overdue" size="sm" className="size-4.5" /> : null}
      </p>
      <p className="mt-px text-caption text-muted-foreground">{label}</p>
    </div>
  )
}
