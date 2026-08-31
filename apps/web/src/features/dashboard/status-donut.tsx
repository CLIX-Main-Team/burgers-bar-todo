import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The dashboard's ring (owner ask 2026-08-21; generalised round 11, 2026-08-23). Hand-drawn SVG
// rather than a charting library: a few arcs and a number is not worth 40kB of Recharts, and a
// library would arrive with its own colours, its own fonts and its own tooltip, none of which
// match this app.
//
// It was a status-only component until the screen grew a second ring for priority. Rather than
// copy the geometry, a segment now carries its own stroke class and the caller supplies the
// meaning — so the status ring paints the STATUS_DOT tones and the priority ring paints the
// priority inks, and both are the same twenty lines of arithmetic.
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
// The ring's own share of the page's entrance (round 12). The first arc starts once the card it
// sits on has finished rising, and each one after it follows a beat later, so three slices read
// as one sweep rather than as three bars appearing at once. The figure in the middle waits for
// the sweep to be well under way: it is the answer, and an answer that lands before the working
// is shown has nothing to land on.
const ARC_DELAY = 180
const ARC_STEP = 110
// The visual break between slices, in the same percentage units. Skipped on a slice too small
// to survive it, so a single remaining task still draws as a sliver instead of vanishing.
const GAP = 1.2

export interface DonutSegment {
  /** Stable across renders — used only as the arc's key. */
  id: string
  value: number
  /** The arc's own stroke utility, e.g. `stroke-status-done-dot`. */
  stroke: string
}

export function Donut({
  segments,
  value,
  caption,
  size = 'md',
  className,
}: {
  /** Drawn in the given order, clockwise from twelve. */
  segments: DonutSegment[]
  /** The figure in the middle, already formatted — a percentage or a bare count. */
  value: string
  /** The word under the figure — what the figure is OF. */
  caption: string
  size?: 'sm' | 'md'
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
    return { id: segment.id, stroke: segment.stroke, drawn, start }
  })

  return (
    <div
      className={cn(
        'relative grid flex-none place-items-center',
        size === 'sm' ? 'size-[88px]' : 'size-[108px]',
        className,
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 36 36" className="size-full -rotate-90">
        {/* The track, so an empty or barely-started board still reads as a ring rather than
            as a broken arc floating in space. */}
        <circle cx="18" cy="18" r={RADIUS} fill="none" strokeWidth="3.4" className="stroke-muted" />
        {arcs.map((arc, index) =>
          arc.drawn <= 0 ? null : (
            <circle
              key={arc.id}
              cx="18"
              cy="18"
              r={RADIUS}
              fill="none"
              strokeWidth="3.4"
              strokeLinecap="butt"
              strokeDasharray={`${arc.drawn} ${CIRCUMFERENCE - arc.drawn}`}
              strokeDashoffset={-arc.start}
              // Each arc draws itself in, one after the next, in the order the ring is read.
              // The dashOFFSET above is untouched by the animation, so an arc grows from where
              // it belongs rather than travelling to it, and the ring fills the way a clock hand
              // sweeps. The delay is inline because it differs per arc, and Tailwind cannot
              // generate a class it never sees written down.
              className={cn(arc.stroke, 'motion-safe:animate-draw')}
              style={{ animationDelay: `${ARC_DELAY + index * ARC_STEP}ms` }}
            />
          ),
        )}
      </svg>

      {/* The figure sits in HTML, not in the SVG: it inherits the app's own type tokens that
          way, so the ring's number is the same face and weight as every other number here. */}
      <div
        className="absolute flex flex-col items-center motion-safe:animate-settle"
        style={delayStyle(420)}
      >
        <span
          className={cn(
            'font-extrabold tabular-nums text-foreground',
            size === 'sm' ? 'text-heading-sm' : 'text-heading-md',
          )}
        >
          {value}
        </span>
        <span className="text-caption text-muted-foreground">{caption}</span>
      </div>
    </div>
  )
}
