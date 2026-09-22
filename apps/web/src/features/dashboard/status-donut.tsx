import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The dashboard's ring (owner ask 2026-08-21; generalised round 11; restyled 2026-09-22 on the
// owner's pick of the reference dashboards' rings: "I like the last design better"). A thick
// ring whose slices end in round caps with a clear gap between them, the figure bold in the
// middle, and what the figure counts set small and spaced out underneath.
//
// Hand-drawn SVG rather than a charting library: a few arcs and a number are not worth a
// dependency that arrives with its own colours, fonts and tooltip. The geometry leans on one
// trick: a radius of 15.9155 gives a circumference of almost exactly 100, so every dash length
// in here IS a percentage. The ring starts at twelve o'clock in either reading direction; a ring
// is not text and does not mirror in RTL.
//
// The ring is aria-hidden on purpose. The legend beside it states every slice's name and count in
// words, and a pie read aloud is worse than the list it would repeat.

const RADIUS = 15.9155
const STROKE = 5.2
// The clear space between two slices, in the ring's percentage units. A round cap reaches half
// the stroke past each end of its dash, so the dash itself is shortened by the gap plus a whole
// stroke width to leave this much air on screen.
const GAP = 0.9
const CAPS = GAP + STROKE
// The ring's own share of the page's entrance: each slice draws in after the one before it.
const ARC_DELAY = 180
const ARC_STEP = 110

interface Arc {
  id: string
  stroke: string
  length: number
  begin: number
  cap: 'butt' | 'round'
}

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
  className,
}: {
  /** Drawn in the given order, clockwise from twelve. */
  segments: DonutSegment[]
  /** The figure in the middle, already formatted. */
  value: string
  /** What the figure counts, set under the ring. */
  caption: string
  className?: string
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  const drawn = segments.filter((segment) => segment.value > 0)

  let offset = 0
  const arcs = segments.flatMap((segment): Arc[] => {
    const share = total === 0 ? 0 : (segment.value / total) * 100
    const start = offset
    offset += share
    if (share === 0) return []
    // One slice is the whole ring: no caps, no gap, a closed circle.
    if (drawn.length === 1) {
      return [{ id: segment.id, stroke: segment.stroke, length: 100, begin: 0, cap: 'butt' }]
    }
    // A slice too short to hold its own caps is drawn as a dot at its middle rather than
    // vanishing, so a single task in a hundred still shows on the ring.
    const room = share - CAPS
    return [
      {
        id: segment.id,
        stroke: segment.stroke,
        length: Math.max(room, 0.001),
        begin: room > 0 ? start + CAPS / 2 : start + share / 2,
        cap: 'round',
      },
    ]
  })

  return (
    <div className={cn('flex flex-col items-center gap-2.5', className)}>
      <div className="relative grid size-[7.5rem] flex-none place-items-center">
        <svg aria-hidden="true" viewBox="0 0 40 40" className="size-full -rotate-90">
          {/* An empty ring still reads as a ring, never as nothing. */}
          {total === 0 ? (
            <circle
              cx="20"
              cy="20"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              className="stroke-muted"
            />
          ) : null}
          {arcs.map((arc, index) => (
            <circle
              key={arc.id}
              cx="20"
              cy="20"
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap={arc.cap}
              strokeDasharray={`${arc.length} ${100 - arc.length}`}
              strokeDashoffset={-arc.begin}
              // Each arc draws itself in from where it belongs, one after the next; the offset
              // is untouched by the keyframe, so a slice grows in place rather than travelling.
              className={cn(arc.stroke, 'motion-safe:animate-draw')}
              style={delayStyle(ARC_DELAY + index * ARC_STEP)}
            />
          ))}
        </svg>
        {/* The figure sits in HTML, not in the SVG, so it is the same face and weight as every
            other number on the page. */}
        <span
          className="absolute text-figure font-bold text-foreground motion-safe:animate-settle"
          style={delayStyle(420)}
        >
          {value}
        </span>
      </div>
      <span className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {caption}
      </span>
    </div>
  )
}
