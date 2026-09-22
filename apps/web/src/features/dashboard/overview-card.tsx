import { useTranslations } from 'use-intl'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { TILE_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { DashboardCard, ENTER } from './dashboard-card.js'
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

// The tiles read the card's own width, not the screen's. Five across is the row the owner signed
// off on his monitor, and his 15-inch laptop has the same root type (18px from 1536px) with 400
// fewer pixels: there the tiles fell to three and two and the hero stretched to match with an
// empty half (owner, 2026-09-22). So five go across from 37rem of card, set closer until 47rem.
//
// A tile three or more across and under 47rem is too narrow for its label beside its glyph
// ("Done this week" broke over three lines and pushed its figure out of the row), so there the
// glyph drops beside the figure and the label takes the tile's whole width. Two across on a
// phone, and from 47rem on the monitor, a tile keeps the glyph by its label. One ladder of
// arbitrary container steps, never a named size beside it (Tailwind v4 sorts those apart).
export const TILES = {
  fiveAcross:
    '@min-[26rem]:grid-cols-3 @min-[37rem]:grid-cols-5 @min-[37rem]:gap-2 @min-[47rem]:gap-3',
  fourAcross: '@min-[35rem]:grid-cols-4',
  fivePadding: '@min-[37rem]:p-3 @min-[47rem]:p-4',
  label: '@min-[26rem]:col-span-2 @min-[47rem]:col-span-1',
  glyph: '@min-[26rem]:row-start-2 @min-[26rem]:mt-3 @min-[47rem]:row-start-1 @min-[47rem]:mt-0',
  figure: '@min-[26rem]:col-span-1 @min-[47rem]:col-span-2',
}

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
  const five = tiles.length === 5

  return (
    <DashboardCard title={t('dashboard.overviewTitle')} delay={delay} className={className}>
      {/* The tiles answer to this wrapper's width (a container), so the same card lays out the
          same way wherever the page puts it, beside the hero or under it. */}
      <div className="@container">
        <div className={cn('grid grid-cols-2 gap-3', five ? TILES.fiveAcross : TILES.fourAcross)}>
          {tiles.map((tile, index) => (
            <div
              key={tile.key}
              className={cn(
                TILE_SURFACE,
                'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] content-start gap-x-2 p-4',
                five && TILES.fivePadding,
                ENTER,
              )}
              style={delayStyle(delay + 60 + index * tileStep)}
            >
              {/* The label leads and the glyph sits at the far end, so the label, the figure and
                  the note share one start edge. The label keeps two lines' height whether it
                  needs them or not, so every figure in the row sits on the same line. */}
              <span
                className={cn(
                  'min-h-10 text-label leading-snug font-semibold text-foreground',
                  TILES.label,
                )}
              >
                {tile.label}
              </span>
              {/* The glyph is a second carrier beside the tone, never a swatch on its own: the
                  tile still reads in greyscale and to a colourblind reader. */}
              <span
                className={cn(
                  'col-start-2 row-start-1 inline-grid size-8 place-items-center rounded-lg',
                  TILES.glyph,
                  TONE[tile.tone],
                )}
              >
                <Icon name={tile.icon} size="sm" />
              </span>
              <p
                className={cn(
                  'col-span-2 mt-3 text-figure font-bold',
                  TILES.figure,
                  tile.alarm ? 'text-destructive' : 'text-foreground',
                )}
              >
                {tile.value}
              </p>
              <p
                className={cn(
                  'col-span-2 mt-2 min-h-[1.4em] text-caption',
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
