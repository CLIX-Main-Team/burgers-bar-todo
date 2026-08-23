import type { TaskStatus } from '@burgers/shared'
import { cn } from '../../lib/cn.js'

// The completion ring (owner ask 2026-08-21). Hand-drawn SVG rather than a charting library:
// three arcs and a number is not worth 40kB of Recharts, and a library would arrive with its
// own colours, its own fonts and its own tooltip, none of which match this app.
//
// The geometry leans on one trick: a radius of 15.9155 gives a circumference of almost exactly
// 100, so every dash length in here IS a percentage and the arithmetic below reads as the thing
// it means. The group is rotated a quarter turn so the ring starts at twelve o'clock, which is
// where a reader expects a progress ring to begin, in either reading direction — a ring is not
// text and does not mirror in RTL.
//
// The ring is aria-hidden on purpose. A pie is a poor thing to read aloud, and the legend beside
// it already states every slice's name, count and share in words. One telling, not two.

const RADIUS = 15.9155
const CIRCUMFERENCE = 100
// The visual break between slices, in the same percentage units. Skipped on a slice too small
// to survive it, so a single remaining task still draws as a sliver instead of vanishing.
const GAP = 1.2

const SEGMENT_STROKE: Record<TaskStatus, string> = {
  done: 'stroke-status-done-dot',
  in_progress: 'stroke-status-in-progress-dot',
  not_started: 'stroke-status-not-started-dot',
}

export interface DonutSegment {
  status: TaskStatus
  value: number
}

export function StatusDonut({
  segments,
  percent,
  caption,
  className,
}: {
  /** Drawn in the given order, clockwise from twelve. */
  segments: DonutSegment[]
  /** The figure in the middle, already rounded. */
  percent: number
  /** The word under the figure — what the percentage is OF. */
  caption: string
  className?: string
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  let offset = 0
  const arcs = segments.map((segment) => {
    const share = total === 0 ? 0 : (segment.value / total) * CIRCUMFERENCE
    const start = offset
    offset += share
    // A slice narrower than its own gap keeps its full length; one wider gives the gap back.
    const drawn = share > GAP * 2 ? share - GAP : share
    return { status: segment.status, drawn, start }
  })

  return (
    <div className={cn('relative grid size-[108px] flex-none place-items-center', className)}>
      <svg aria-hidden="true" viewBox="0 0 36 36" className="size-full -rotate-90">
        {/* The track, so an empty or barely-started board still reads as a ring rather than
            as a broken arc floating in space. */}
        <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.4" className="stroke-muted" />
        {arcs.map((arc) =>
          arc.drawn <= 0 ? null : (
            <circle
              key={arc.status}
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              strokeWidth="3.4"
              strokeLinecap="butt"
              strokeDasharray={`${arc.drawn} ${CIRCUMFERENCE - arc.drawn}`}
              strokeDashoffset={-arc.start}
              className={SEGMENT_STROKE[arc.status]}
            />
          ),
        )}
      </svg>

      {/* The figure sits in HTML, not in the SVG: it inherits the app's own type tokens that
          way, so the ring's number is the same face and weight as every other number here. */}
      <div className="absolute flex flex-col items-center">
        <span className="text-heading-md font-extrabold tabular-nums text-foreground">
          {percent}%
        </span>
        <span className="text-caption text-muted-foreground">{caption}</span>
      </div>
    </div>
  )
}
