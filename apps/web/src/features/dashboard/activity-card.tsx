import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslations } from 'use-intl'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import type { SharedTask } from '../tasks/task-filters.js'
import { monotonePath, niceMax } from './chart-geometry.js'
import { DashboardCard, Legend, PillGroup } from './dashboard-card.js'
import { type ActivityDay, activitySeries } from './dashboard-metrics.js'

// Team activity: tasks created against tasks completed, per day (round 3, 2026-09-22). The two
// lines answer the question a manager actually has about throughput, whether the team is keeping
// up with what lands on it, which a count of finished work alone cannot. It replaces round 11's
// "Finished each day", whose six earlier days were invented; every point here is the board's own
// createdAt and completedAt.
//
// One axis, both series in the same unit (dataviz: never two scales on one plot). Created is the
// ink, completed is the done green every finished task already wears, and the legend names both
// so the colour is never the only carrier. In Hebrew the time axis mirrors so time runs in the
// reading direction, oldest at the right and today at the far left, the way the round-11 week card
// already ran.

const RANGES = [7, 14, 30] as const
type Range = (typeof RANGES)[number]

// The plot's margins in px: the value axis gutter, the far edge, the top, the date band.
const GUTTER = 28
const FAR = 8
const TOP = 10
const DATES = 26

export function ActivityCard({
  tasks,
  now,
  delay,
  className,
}: {
  tasks: SharedTask[]
  now: Date
  delay: number
  className?: string
}) {
  const t = useTranslations()
  const [range, setRange] = useState<Range>(14)
  const series = activitySeries(tasks, now, range)

  return (
    <DashboardCard
      title={t('dashboard.activityTitle')}
      note={t('dashboard.activityNote')}
      delay={delay}
      className={className}
      action={
        <PillGroup
          label={t('dashboard.activityTitle')}
          value={String(range)}
          onChange={(next) => setRange(Number(next) as Range)}
          options={RANGES.map((days) => ({
            value: String(days),
            label: String(days),
            title: t('dashboard.activityRange', { days }),
          }))}
        />
      }
    >
      <Legend
        items={[
          { label: t('dashboard.activityCreated'), swatch: 'bg-foreground' },
          { label: t('dashboard.activityCompleted'), swatch: 'bg-status-done-dot' },
        ]}
      />
      <ActivityChart series={series} delay={delay} />
    </DashboardCard>
  )
}

function ActivityChart({ series, delay }: { series: ActivityDay[]; delay: number }) {
  const t = useTranslations()
  const { locale, direction } = useLocale()
  const rtl = direction === 'rtl'
  const box = useRef<HTMLElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [active, setActive] = useState<number | null>(null)
  const id = useId()

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Day and month by name, never 9/10: the same digits read as two different days to an English
  // and an Israeli reader, and this app has both.
  const dateLabel = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
  const dateLong = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const count = series.length
  const { width, height } = size
  const plotWidth = Math.max(width - GUTTER - FAR, 1)
  const plotHeight = Math.max(height - TOP - DATES, 1)
  const max = niceMax(Math.max(0, ...series.map((day) => Math.max(day.created, day.completed))))
  const base = TOP + plotHeight

  // Geometry is worked out left to right and mirrored as a whole for Hebrew, so the curve maths
  // never has to know about direction: the paths sit in a flipped group, the text never does.
  const xAt = (index: number) =>
    GUTTER + (count === 1 ? plotWidth / 2 : (plotWidth * index) / (count - 1))
  const screenX = (index: number) => (rtl ? width - xAt(index) : xAt(index))
  const yAt = (value: number) => TOP + plotHeight * (1 - value / max)

  const created = monotonePath(series.map((day, index) => [xAt(index), yAt(day.created)]))
  const completed = monotonePath(series.map((day, index) => [xAt(index), yAt(day.completed)]))
  const area = (path: string) => `${path} L${xAt(count - 1)},${base} L${xAt(0)},${base} Z`

  // Label every k-th day counted back from today, so today is always named and the spacing
  // stays even; k grows as the plot narrows so no two dates ever touch.
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / 52))))

  const pick = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return
    const pointer = event.clientX - rect.left
    const ltr = rtl ? width - pointer : pointer
    const step = count === 1 ? 1 : plotWidth / (count - 1)
    setActive(Math.min(count - 1, Math.max(0, Math.round((ltr - GUTTER) / step))))
  }

  // The keyboard reads the same readout the pointer does. The arrows move in the direction they
  // point on screen, so in Hebrew the left arrow walks toward today.
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    if (event.key !== forward && event.key !== back) return
    event.preventDefault()
    setActive((current) => {
      const from = current ?? count - 1
      return Math.min(count - 1, Math.max(0, from + (event.key === forward ? 1 : -1)))
    })
  }

  const day = active === null ? undefined : series[active]
  const tipOnLeft = active !== null && screenX(active) > width / 2

  return (
    <figure
      ref={box}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is keyboard-readable (arrows walk the days) and says so through its label; the table below carries the same numbers for a screen reader.
      tabIndex={0}
      aria-label={t('dashboard.activityChart', { days: count })}
      onKeyDown={onKey}
      onFocus={() => setActive((current) => current ?? count - 1)}
      onBlur={() => setActive(null)}
      className="relative m-0 mt-4 h-60 min-h-60 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    >
      {width > 0 ? (
        <svg
          aria-hidden="true"
          width={width}
          height={height}
          className="absolute inset-0 overflow-visible [direction:ltr]"
        >
          <defs>
            <linearGradient
              id={`${id}-created`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
              className="text-foreground"
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0.14" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id={`${id}-completed`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
              className="text-status-done-dot"
            >
              <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3, 4].map((step) => {
            const value = (max / 4) * step
            const y = yAt(value)
            return (
              <g key={step}>
                <line
                  x1={rtl ? FAR : GUTTER}
                  x2={rtl ? width - GUTTER : width - FAR}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  strokeWidth="1"
                />
                <text
                  x={rtl ? width - GUTTER + 8 : GUTTER - 8}
                  y={y + 4}
                  textAnchor={rtl ? 'start' : 'end'}
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {value}
                </text>
              </g>
            )
          })}

          {series.map((entry, index) =>
            (count - 1 - index) % every === 0 ? (
              <text
                key={entry.date.getTime()}
                x={screenX(index)}
                y={height - 6}
                textAnchor="middle"
                className={cn(
                  'text-[11px] tabular-nums',
                  index === count - 1 ? 'fill-foreground font-semibold' : 'fill-muted-foreground',
                )}
              >
                {dateLabel.format(entry.date)}
              </text>
            ) : null,
          )}

          <g transform={rtl ? `translate(${width},0) scale(-1,1)` : undefined}>
            <path
              d={area(created)}
              fill={`url(#${id}-created)`}
              className="motion-safe:animate-settle"
              style={delayStyle(delay + 420)}
            />
            <path
              d={area(completed)}
              fill={`url(#${id}-completed)`}
              className="motion-safe:animate-settle"
              style={delayStyle(delay + 480)}
            />
            {/* pathLength makes the dash arithmetic a percentage, so the draw-in keyframe can
                grow each line from 0 to its whole length without knowing that length. */}
            <path
              d={created}
              pathLength={100}
              strokeDasharray="100 0"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-foreground motion-safe:animate-draw"
              style={delayStyle(delay + 200)}
            />
            <path
              d={completed}
              pathLength={100}
              strokeDasharray="100 0"
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-status-done-dot motion-safe:animate-draw"
              style={delayStyle(delay + 280)}
            />
          </g>

          {day !== undefined && active !== null ? (
            <g>
              <line
                x1={screenX(active)}
                x2={screenX(active)}
                y1={TOP}
                y2={base}
                className="stroke-border-strong"
                strokeWidth="1"
              />
              <circle
                cx={screenX(active)}
                cy={yAt(day.created)}
                r="4.5"
                strokeWidth="2"
                className="fill-foreground stroke-card"
              />
              <circle
                cx={screenX(active)}
                cy={yAt(day.completed)}
                r="4.5"
                strokeWidth="2"
                className="fill-status-done-dot stroke-card"
              />
            </g>
          ) : null}

          <rect
            x={rtl ? FAR : GUTTER}
            y={TOP}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={pick}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      ) : null}

      {/* The readout. Values lead and names follow, the legend's order inverted, because here
          the reader already has the series and wants the number. */}
      {day !== undefined && active !== null ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-border-strong bg-popover px-3 py-2.5 text-caption shadow-md"
          style={
            tipOnLeft
              ? { left: Math.max(screenX(active) - 12 - 160, 0) }
              : { left: Math.min(screenX(active) + 12, Math.max(width - 160, 0)) }
          }
        >
          <p className="mb-1.5 text-muted-foreground">{dateLong.format(day.date)}</p>
          <p className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-foreground" />
            {t('dashboard.activityCreated')}
            <span className="ms-auto font-bold tabular-nums text-foreground">{day.created}</span>
          </p>
          <p className="mt-1 flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-3 rounded-full bg-status-done-dot" />
            {t('dashboard.activityCompleted')}
            <span className="ms-auto font-bold tabular-nums text-foreground">{day.completed}</span>
          </p>
        </div>
      ) : null}

      {/* The chart's table twin: every value the lines draw, reachable without seeing them. */}
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">{t('dashboard.activityTitle')}</th>
            <th scope="col">{t('dashboard.activityCreated')}</th>
            <th scope="col">{t('dashboard.activityCompleted')}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => (
            <tr key={entry.date.getTime()}>
              <th scope="row">{dateLong.format(entry.date)}</th>
              <td>{entry.created}</td>
              <td>{entry.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
