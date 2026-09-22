import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The hero card's motif: a kitchen order rail (round 16, 2026-09-22).
//
// The first motif was a ripple of rings, taken from the reference dashboards; the owner said it
// "looks like a data or wifi connection" and asked for something more original. So the picture
// comes from the restaurant itself. Above every kitchen pass hangs a steel rail with the order
// tickets clipped to it, one ticket per job, pulled down when the job is done, and the open tasks
// on this card are exactly that: the shift's tickets still on the rail.
//
// Drawn in the app's own hand rather than as an illustration: paper in the sunken surface, a
// hairline edge, three faint lines of writing, a torn bottom. The only colour is the band across
// each ticket's head, and it is the data: red for late, amber for due today, grey for the rest,
// dealt in proportion to the real counts. An empty board is an empty rail.

export type TicketTone = 'late' | 'today' | 'open'

// Where each ticket hangs, how long it is and how far it swings: a few degrees each way, so the
// row reads as paper on a rail and not as a bar chart.
const SLOTS = [
  { x: 34, length: 84, tilt: -3 },
  { x: 84, length: 98, tilt: 2 },
  { x: 134, length: 76, tilt: -1.5 },
  { x: 184, length: 92, tilt: 2.5 },
  { x: 234, length: 82, tilt: -2 },
]

const BAND: Record<TicketTone, string> = {
  late: 'fill-destructive',
  today: 'fill-status-not-started-dot',
  open: 'fill-border-strong',
}

const RAIL_Y = 14
const HALF = 20
const TEETH = 8
const BITE = 4

// The tickets on the rail and the band each one wears. At most one ticket per slot; the late
// and today shares are dealt in proportion to the real counts, and each gets at least one ticket
// whenever it has any work at all, so a single late task is never rounded off the rail. Late work
// hangs at the front, nearest the figure it belongs to.
export function ticketTones(open: number, overdue: number, dueToday: number): TicketTone[] {
  const count = Math.min(open, SLOTS.length)
  if (count === 0) return []
  const late = Math.min(overdue > 0 ? Math.max(1, Math.round((overdue / open) * count)) : 0, count)
  const today = Math.min(
    dueToday > 0 ? Math.max(1, Math.round((dueToday / open) * count)) : 0,
    count - late,
  )
  return [
    ...Array<TicketTone>(late).fill('late'),
    ...Array<TicketTone>(today).fill('today'),
    ...Array<TicketTone>(count - late - today).fill('open'),
  ]
}

// A ticket hanging from its clip at the origin: straight sides, a torn bottom edge.
function ticketPath(length: number): string {
  const step = (HALF * 2) / TEETH
  let path = `M${-HALF},4 H${HALF} V${length}`
  for (let tooth = 1; tooth <= TEETH; tooth++) {
    path += ` L${HALF - step * tooth},${tooth % 2 === 1 ? length - BITE : length}`
  }
  return `${path} Z`
}

export function OrderRail({
  open,
  overdue,
  dueToday,
  delay,
  className,
}: {
  open: number
  overdue: number
  dueToday: number
  delay: number
  className?: string
}) {
  const tones = ticketTones(open, overdue, dueToday)

  return (
    // Mirrored whole in Hebrew so the rail runs toward the reading end and the late tickets stay
    // nearest the figure; it carries no text, so nothing reads backwards.
    <svg
      aria-hidden="true"
      viewBox="0 0 272 118"
      className={cn('overflow-visible rtl:-scale-x-100', className)}
    >
      {/* The rail on its wall bracket, running on past the card's edge: there is always more
          kitchen. */}
      <rect
        x="2"
        y={RAIL_Y - 7}
        width="7"
        height="14"
        rx="2"
        className="fill-muted-foreground/70"
      />
      <rect x="6" y={RAIL_Y - 3} width="300" height="6" rx="3" className="fill-border-strong" />

      {tones.map((tone, index) => {
        const slot = SLOTS[index]
        if (!slot) return null
        return (
          <g key={slot.x} transform={`translate(${slot.x} ${RAIL_Y}) rotate(${slot.tilt})`}>
            {/* The swing plays on an inner group, about the clip at its top, so the arrival
                never fights the resting tilt the outer group holds. */}
            <g
              className="motion-safe:animate-hang"
              style={{
                transformBox: 'fill-box',
                transformOrigin: '50% 0%',
                ...delayStyle(delay + 160 + index * 70),
              }}
            >
              <path
                d={ticketPath(slot.length)}
                strokeWidth="1"
                className="fill-surface-sunken stroke-border-strong"
              />
              <rect
                x={-HALF + 4}
                y="9"
                width={HALF * 2 - 8}
                height="5"
                rx="1.5"
                className={BAND[tone]}
              />
              <g strokeWidth="2.5" strokeLinecap="round" className="stroke-border">
                <line x1={-HALF + 5} x2={HALF - 8} y1="24" y2="24" />
                <line x1={-HALF + 5} x2={HALF - 16} y1="32" y2="32" />
                <line x1={-HALF + 5} x2={HALF - 11} y1="40" y2="40" />
              </g>
              {/* the clip that holds it to the rail */}
              <rect
                x="-6"
                y="-7"
                width="12"
                height="12"
                rx="3"
                className="fill-muted-foreground/70"
              />
            </g>
          </g>
        )
      })}
    </svg>
  )
}
