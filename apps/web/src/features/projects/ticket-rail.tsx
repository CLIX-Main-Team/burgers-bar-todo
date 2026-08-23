import { cn } from '../../lib/cn.js'

// A project's progress, drawn as ONE SEGMENT PER TASK rather than as a filled percentage bar.
//
// The reason is that a project's progress is not a percentage — it is a count of things, and a
// count is what a manager acts on. "8 of 14" answers a question; "57%" is the same fact with
// the actionable part sanded off. Segments let the eye do the arithmetic before the label is
// read, and they make two projects at the same percentage but different sizes look as
// different as they are: 3-of-21 is visibly a long road, 11-of-13 is visibly nearly over.
//
// It also happens to be the shape the chain already thinks in. A shift is a rail of tickets
// and each one is either up or not; this is the same rail.
//
// Past a point the segments stop being countable and start being noise, so a project bigger
// than the cap falls back to a continuous bar. That threshold is a rendering detail, not a
// rule about projects — nothing else changes.
const MAX_SEGMENTS = 24

export function TicketRail({
  done,
  total,
  // The project's identity ground, e.g. `bg-person-3` (project-fixtures.ts). The rail is the
  // one large field of a project's own colour on the card, which is what makes a grid of them
  // scannable; the empty part stays neutral so the filled part is the only thing that reads.
  fill,
  className,
}: {
  done: number
  total: number
  fill: string
  className?: string
}) {
  const filled = Math.max(0, Math.min(done, total))

  // Decorative in both branches: the count beside the rail states the same fact in words, and
  // a screen reader should hear it once rather than twice.
  if (total === 0 || total > MAX_SEGMENTS) {
    const percent = total === 0 ? 0 : Math.round((filled / total) * 100)
    return (
      <div
        aria-hidden="true"
        className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)}
      >
        <div className={cn('h-full rounded-full', fill)} style={{ width: `${percent}%` }} />
      </div>
    )
  }

  return (
    <div aria-hidden="true" className={cn('flex h-1.5 gap-[2px]', className)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          // The segments are positional and interchangeable — segment 4 is not a particular
          // task, it is the fourth notch — so the slot IS the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional scale, never reordered.
          key={index}
          className={cn('h-full flex-1 rounded-[1px]', index < filled ? fill : 'bg-muted')}
        />
      ))}
    </div>
  )
}
