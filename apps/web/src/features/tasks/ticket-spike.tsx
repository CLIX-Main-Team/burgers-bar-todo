import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The subject page's motif: the ticket spike (Tasks redesign, 2026-09-22).
//
// The Dashboard hangs the shift's open work on the order rail above the pass. What happens to a
// ticket once the job is done is the other half of the same kitchen: it comes off the rail and is
// pushed down onto the spike by the pass, a steel pin on a round foot where the finished tickets
// pile up through the shift. So a subject's page carries its finished work that way: the pin is
// the whole subject and the pile on it is how far through it the team has got.
//
// Drawn in the rail's hand, not as an illustration: paper in the sunken surface, a hairline edge,
// and no colour at all, since every slip on a spike means the same thing. Only the slip on top
// shows its tear and its writing; the ones under it are the edges of a pile. The one number it
// carries is the pile's height, dealt from the real counts by spikeSlips below. A subject with
// nothing done is a bare spike.

export const SPIKE_SLIPS = 8

// How many slips sit on the spike: the done share of the subject, in eighths of the pin. Rounded
// to the nearest slip, but never to none while something is done or to a full pin while something
// is left, the two facts a rounded picture must not lose (the ticket rail's rule). And never more
// slips than there are finished tasks, so each slip is always at least one real ticket.
export function spikeSlips(done: number, total: number): number {
  if (done <= 0 || total <= 0) return 0
  const share =
    done >= total
      ? SPIKE_SLIPS
      : Math.min(SPIKE_SLIPS - 1, Math.max(1, Math.round((done / total) * SPIKE_SLIPS)))
  return Math.min(done, share)
}

const PIN_X = 60
const TIP_Y = 6
const FOOT_TOP = 133
const FOOT_Y = 146
// Where the lowest slip is pierced, and how far up the pin each slip above it sits.
const FIRST_Y = 118
const STEP = 10
const HALF = 32
const RISE = 11
const DROP = 13
const TEETH = 12
const BITE = 2.5

// Each slip's own lean, so the pile reads as paper pushed down in a hurry and not as a stack of
// bars. Fixed rather than random: the same subject draws the same pile every time.
const TILTS = [-3, 4, -6, 2, -2, 5, -4, 3]
const SHIFTS = [0, -2, 2, -1, 3, -3, 1, 0]

// A slip pierced at the origin. The top one is torn along its bottom edge, the way it came off
// the printer; the ones under it show only their edges, and plain ones keep the pile calm.
function slipPath(torn: boolean): string {
  if (!torn) return `M${-HALF},${-RISE} H${HALF} V${DROP} H${-HALF} Z`
  const step = (HALF * 2) / TEETH
  let path = `M${-HALF},${-RISE} H${HALF} V${DROP}`
  for (let tooth = 1; tooth <= TEETH; tooth++) {
    path += ` L${HALF - step * tooth},${tooth % 2 === 1 ? DROP - BITE : DROP}`
  }
  return `${path} Z`
}

const PLAIN = slipPath(false)
const TORN = slipPath(true)

function pinPath(fromY: number): string {
  return `M${PIN_X - 1.6},${fromY} V${TIP_Y + 7} L${PIN_X},${TIP_Y} L${PIN_X + 1.6},${TIP_Y + 7} V${fromY} Z`
}

export function TicketSpike({
  done,
  total,
  delay,
  className,
}: {
  done: number
  total: number
  /** Where the pile starts in the page's entrance, in ms. */
  delay: number
  className?: string
}) {
  const slips = spikeSlips(done, total)
  const topY = FIRST_Y - (slips - 1) * STEP

  return (
    // Mirrored in Hebrew so the slips lean the reading way; it carries no text.
    <svg
      aria-hidden="true"
      viewBox="0 0 120 146"
      className={cn('overflow-visible rtl:-scale-x-100', className)}
    >
      {/* The pin, whole, behind the pile: the slips cover it and it shows only above them. */}
      <path d={pinPath(FOOT_TOP + 2)} className="fill-muted-foreground/70" />

      {Array.from({ length: slips }, (_, index) => {
        const top = index === slips - 1
        return (
          <g
            // Positional: slip three is the third one up, not a particular task.
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pile, never reordered.
            key={index}
            transform={`translate(${PIN_X + (SHIFTS[index] ?? 0)} ${FIRST_Y - index * STEP})`}
          >
            {/* The drop plays on an inner group so it never fights the lean the outer one
                holds: each slip falls the last stretch of the pin onto the one below it, the
                lowest first. */}
            <g className="motion-safe:animate-spike" style={delayStyle(delay + 140 + index * 70)}>
              <g transform={`rotate(${TILTS[index] ?? 0})`}>
                <path
                  d={top ? TORN : PLAIN}
                  strokeWidth="1.25"
                  strokeLinejoin="round"
                  className="fill-surface-sunken stroke-border-strong"
                />
                {top ? (
                  <>
                    <g strokeWidth="2.5" strokeLinecap="round" className="stroke-border-strong">
                      <line x1={-HALF + 7} x2={-7} y1="-4" y2="-4" />
                      <line x1={7} x2={HALF - 10} y1="-4" y2="-4" />
                      <line x1={-HALF + 7} x2={HALF - 16} y1="4" y2="4" />
                    </g>
                    {/* where the pin went through */}
                    <circle r="2.4" className="fill-muted-foreground/70" />
                  </>
                ) : null}
              </g>
            </g>
          </g>
        )
      })}

      {/* The pin again from the top slip up, so it reads as driven through the pile rather than
          standing behind it. */}
      {slips > 0 ? <path d={pinPath(topY)} className="fill-muted-foreground/70" /> : null}

      {/* The low round foot it stands on, seen from the side. */}
      <path
        d={`M${PIN_X - 32},${FOOT_Y} C${PIN_X - 32},${FOOT_TOP} ${PIN_X - 20},${FOOT_TOP} ${PIN_X},${FOOT_TOP} C${PIN_X + 20},${FOOT_TOP} ${PIN_X + 32},${FOOT_TOP} ${PIN_X + 32},${FOOT_Y} Z`}
        className="fill-muted-foreground/70"
      />
    </svg>
  )
}
