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
// Always tiles (owner call 2026-09-15: a forty-step opening checklist had fallen back to a plain
// bar, and the tiles are the look). Up to the cap every tile is one step. Past it the rail keeps
// the cap's worth of tiles and each stands for an equal share of the steps, so a hundred-step
// project still reads as a rail of tickets rather than as hairlines; the count beside it carries
// the exact number either way.
const MAX_SEGMENTS = 50

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

  const tiles = Math.min(total, MAX_SEGMENTS)
  // Rounded to the nearest tile, but never to zero while something is done or to full while
  // something is left: "started" and "not finished" are the two facts a rounded rail must not lose.
  const lit =
    total <= MAX_SEGMENTS
      ? filled
      : filled === 0 || filled === total
        ? (filled / total) * tiles
        : Math.min(tiles - 1, Math.max(1, Math.round((filled / total) * tiles)))

  // Decorative: the count beside the rail states the same fact in words, and a screen reader
  // should hear it once rather than twice. A project with no steps yet is one empty track.
  if (total === 0) {
    return <div aria-hidden="true" className={cn('h-1.5 rounded-full bg-muted', className)} />
  }

  return (
    <div aria-hidden="true" className={cn('flex h-1.5 gap-[2px]', className)}>
      {Array.from({ length: tiles }, (_, index) => (
        <span
          // The segments are positional and interchangeable — segment 4 is not a particular
          // task, it is the fourth notch — so the slot IS the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional scale, never reordered.
          key={index}
          className={cn('h-full flex-1 rounded-[1px]', index < lit ? fill : 'bg-muted')}
        />
      ))}
    </div>
  )
}
