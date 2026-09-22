import { useTranslations } from 'use-intl'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { DashboardCard, ENTER, TILE_SURFACE } from './dashboard-card.js'
import type { Overview } from './dashboard-metrics.js'

// The overview tiles: the four states of the board a manager acts on, plus the projects in
// flight, each with one line of context under its figure (round 3, 2026-09-22). The line is what
// turns a count into a reading: "12 due today" is a number, "4 already started" says whether to
// worry about it.
//
// `tone` names the STATE, not a colour, and every one is the token that state already wears on a
// card, a lane head or a due line. The projects tile is neutral on purpose: a count of running
// projects is not a state, and a hue spent on it would be the page's first decorative colour.
const TONE = {
  warning: 'bg-warning-muted text-warning-muted-foreground',
  progress: 'bg-status-in-progress-dot/12 text-status-in-progress-foreground',
  danger: 'bg-destructive-muted text-destructive-muted-foreground',
  success: 'bg-success-muted text-success-muted-foreground',
  neutral: 'bg-muted text-muted-foreground',
} as const

interface TileSpec {
  key: string
  icon: IconRole
  tone: keyof typeof TONE
  label: string
  value: number
  /** The figure in the destructive ink: only a late count that is not zero asks for that. */
  alarm?: boolean
  note: string
  noteTone?: 'good' | 'bad'
}

export function OverviewCard({
  overview,
  projects,
  delay,
  tileStep,
  className,
}: {
  overview: Overview
  /** Null for a viewer without the Projects page, who gets four tiles. */
  projects: { running: number; late: number } | null
  delay: number
  tileStep: number
  className?: string
}) {
  const t = useTranslations()
  const trend = weekTrend(overview.doneThisWeek, overview.doneLastWeek)

  const tiles: TileSpec[] = [
    {
      key: 'due',
      icon: 'due-date',
      tone: 'warning',
      label: t('dashboard.tileDueToday'),
      value: overview.dueToday,
      note:
        overview.dueToday === 0
          ? ''
          : t('dashboard.tileDueTodayNote', { count: overview.dueTodayStarted }),
    },
    {
      key: 'progress',
      icon: 'status-in-progress',
      tone: 'progress',
      label: t('dashboard.tileInProgress'),
      value: overview.inProgress,
      note: t('dashboard.tileInProgressNote', { count: overview.inProgressPlaces }),
    },
    {
      key: 'overdue',
      icon: 'overdue',
      tone: 'danger',
      label: t('dashboard.tileOverdue'),
      value: overview.overdue,
      alarm: overview.overdue > 0,
      note:
        overview.oldestOverdueDays === null
          ? t('dashboard.tileOverdueNone')
          : t('dashboard.tileOverdueNote', { days: overview.oldestOverdueDays }),
    },
    {
      key: 'done',
      icon: 'status-done',
      tone: 'success',
      label: t('dashboard.tileDoneWeek'),
      value: overview.doneThisWeek,
      note:
        trend.kind === 'up'
          ? t('dashboard.tileDoneWeekUp', { percent: trend.percent })
          : trend.kind === 'down'
            ? t('dashboard.tileDoneWeekDown', { percent: trend.percent })
            : trend.kind === 'new'
              ? t('dashboard.tileDoneWeekNew')
              : t('dashboard.tileDoneWeekSame'),
      noteTone: trend.kind === 'up' ? 'good' : trend.kind === 'down' ? 'bad' : undefined,
    },
  ]
  if (projects) {
    tiles.push({
      key: 'projects',
      icon: 'folder',
      tone: 'neutral',
      label: t('dashboard.tileProjects'),
      value: projects.running,
      note:
        projects.late > 0
          ? t('dashboard.tileProjectsLate', { count: projects.late })
          : t('dashboard.tileProjectsOnTime'),
      noteTone: projects.late > 0 ? 'bad' : undefined,
    })
  }

  return (
    <DashboardCard title={t('dashboard.overviewTitle')} delay={delay} className={className}>
      {/* Five across only where a tile still has room for its label beside its glyph: the root
          type grows to 18px on a desktop, so at 1280-1600px five tiles would be 105-140px wide
          and "In progress" would run under its own icon. One ladder of arbitrary steps, never
          mixed with a named breakpoint on the same property (Tailwind v4 sorts those apart). */}
      <div
        className={cn(
          'grid grid-cols-2 gap-3',
          tiles.length === 5
            ? 'min-[640px]:grid-cols-3 min-[1800px]:grid-cols-5'
            : 'min-[1800px]:grid-cols-4',
        )}
      >
        {tiles.map((tile, index) => (
          <div
            key={tile.key}
            className={cn(TILE_SURFACE, 'flex min-w-0 flex-col p-4', ENTER)}
            style={delayStyle(delay + 60 + index * tileStep)}
          >
            {/* The label leads and the glyph sits at the far end, so the label, the figure and
                the note share one start edge, and a label that wraps (tiles are narrow on a
                laptop) has the tile's whole width. The row keeps two lines' height either way,
                so every figure in the row sits on the same line. */}
            <div className="flex min-h-10 items-start gap-2">
              <span className="min-w-0 flex-1 text-label leading-snug font-semibold text-foreground">
                {tile.label}
              </span>
              {/* The glyph is a second carrier beside the tone, never a swatch on its own: the
                  tile still reads in greyscale and to a colourblind reader. */}
              <span
                className={cn(
                  'inline-grid size-8 flex-none place-items-center rounded-lg',
                  TONE[tile.tone],
                )}
              >
                <Icon name={tile.icon} size="sm" />
              </span>
            </div>
            <p
              className={cn(
                'mt-3 text-figure font-bold',
                tile.alarm ? 'text-destructive' : 'text-foreground',
              )}
            >
              {tile.value}
            </p>
            <p
              className={cn(
                'mt-2 min-h-[1.4em] text-caption',
                tile.noteTone === 'good'
                  ? 'font-semibold text-success-muted-foreground'
                  : tile.noteTone === 'bad'
                    ? 'font-semibold text-destructive'
                    : 'text-muted-foreground',
              )}
            >
              {tile.note}
            </p>
          </div>
        ))}
      </div>
    </DashboardCard>
  )
}

type WeekTrend = { kind: 'up' | 'down'; percent: number } | { kind: 'same' | 'new' }

// This week's finished count against last week's, as a whole percentage. A week that follows an
// empty one has no percentage to give (anything over zero is infinitely more), so it says so in
// words instead of printing a number that means nothing.
function weekTrend(thisWeek: number, lastWeek: number): WeekTrend {
  if (lastWeek === 0) return thisWeek === 0 ? { kind: 'same' } : { kind: 'new' }
  const percent = Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
  if (percent === 0) return { kind: 'same' }
  return percent > 0 ? { kind: 'up', percent } : { kind: 'down', percent: -percent }
}
