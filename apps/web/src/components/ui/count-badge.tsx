import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn.js'
import { EXIT_MS } from '../../lib/motion.js'
import { Badge } from './badge.js'

// The app's notification counter: the solid red disc that says how many things here are yours
// and still open. Every counter in the app is this one component, because the side nav and a
// project card showing the same idea in two different shapes is how they drifted apart before.
//
// It is a circle at one digit and a stadium past that. Height and minimum width are the SAME
// step, so the disc is square by construction at any root font size, and only a number too wide
// for it pushes the sides out. Getting there by horizontal padding alone is what made the first
// one an oval (owner call 2026-08-30): the Badge base pads 9px each side against a ~17px line
// box, so a single digit came out 4px wider than it was tall. `leading-none` keeps the digit off
// the inherited line box, which is taller than the disc.
//
// The number itself is hidden from assistive tech and a full sentence is read instead, so a
// screen reader hears "3 steps here are yours", never a bare digit floating beside a link.
export function CountBadge({
  count,
  label,
  className,
}: {
  count: number
  label: string
  className?: string
}) {
  // A counter that changes while someone is looking at it (round 15, 2026-08-31). Optimistic
  // writes are the reason this is worth having: tick a step and the count beside the project
  // moves at once, and a number that swaps digits in place is very easy to miss. The disc
  // swells and returns rather than flashing a colour, so it still reads on a badge that is
  // already red and for anyone who cannot separate the two reds.
  //
  // Deliberately NOT keyed off the render — a `key={count}` remount would pop every badge on
  // the page the first time it is drawn, which is noise on arrival, not news.
  const previous = useRef(count)
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    if (previous.current === count) return
    previous.current = count
    setChanged(true)
    const timer = window.setTimeout(() => setChanged(false), EXIT_MS * 2)
    return () => window.clearTimeout(timer)
  }, [count])

  return (
    <Badge
      variant="destructive"
      className={cn(
        'h-5 min-w-5 justify-center px-1 py-0 leading-none tabular-nums',
        changed && 'motion-safe:animate-pop',
        className,
      )}
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  )
}
