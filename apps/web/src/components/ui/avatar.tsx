import { cn } from '../../lib/cn.js'

// A person's initials in a circle (issue #213, components.md §Avatar): the assignee mark on
// a task card. There are no uploaded photos in v1, so the fallback — initials on a soft
// `accent` ground — is the whole component. A single avatar is decorative on its own; the
// name it stands for is announced by the surrounding control (the stack's sr-only label),
// so the circle stays aria-hidden and never double-announces.

// The initials for a display name: the first character of the first word, plus the first of
// the last word when the name has two or more. `Intl.Segmenter` (grapheme granularity) takes
// exactly one user-perceived character even for a surrogate-pair or combining glyph, and it
// is script-agnostic — a Hebrew name yields a Hebrew letter, a Latin name a Latin one — so
// the mark reads right inside chrome of either direction.
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const firstWord = words[0]
  if (!firstWord) return '?'
  const first = firstGrapheme(firstWord)
  if (words.length === 1) return first.toLocaleUpperCase()
  const lastWord = words[words.length - 1] ?? firstWord
  return (first + firstGrapheme(lastWord)).toLocaleUpperCase()
}

function firstGrapheme(word: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(word)) return segment
  return word.slice(0, 1)
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      dir="auto"
      className={cn(
        'inline-grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

// The overlapping stack of assignees on a card's meta row. Each avatar after the first slides
// back over its neighbour (logical `-ms-2`, so it mirrors in RTL) and carries a `card`-coloured
// ring so the overlap reads as separate people rather than a smear. The names ride in an
// sr-only label ("Assigned to Dana, Noa") so a screen-reader user hears the assignment the
// avatars show visually — and, since 2026-08-12 (owner ask), each circle also names its person
// in a small CSS-only tooltip: :hover carries the desktop pointer, :active carries a phone's
// press-and-hold, so the same classes serve both without any JS. select-none keeps the hold
// from starting a text selection instead.
export function AvatarStack({
  names,
  label,
  className,
}: {
  names: string[]
  // The screen-reader phrasing, e.g. "Assigned to" — the caller owns the localised word.
  label: string
  className?: string
}) {
  if (names.length === 0) return null
  return (
    // relative is load-bearing, not cosmetic: sr-only is position:absolute, and without a
    // positioned ancestor its box anchors to the viewport at its static position — escaping
    // every overflow clip in the shell and stretching the *document* under any card that lays
    // out below the fold (the prod two-scrollbars / unpinned-tab-bar bug, 2026-08-12). With
    // the stack positioned, the hidden box resolves inside the card and clips with it.
    <span className={cn('relative inline-flex items-center', className)}>
      <span className="sr-only">
        {label} {names.join(', ')}
      </span>
      <span aria-hidden className="flex">
        {names.map((name, index) => (
          <span
            // Names can repeat, so pair the name with its slot for a stable key. The stack is a
            // static, non-reordering, stateless display, so the slot index is a safe identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: static, stateless avatar list — names may repeat, so the slot disambiguates.
            key={`${name}-${index}`}
            className={cn('group relative select-none', index > 0 && '-ms-2')}
          >
            <Avatar name={name} className="ring-2 ring-card" />
            {/* The name bubble: hung from the circle's inline-start edge and growing toward
                the inline-end — the stack sits at its row's inline-start, so a centred bubble
                on the first avatar clipped off the screen edge on a phone; anchored this way
                it always grows into the card. Foreground-on-background like a native tooltip,
                inert to the pointer so it never traps the hover that opened it. */}
            <span
              dir="auto"
              className="pointer-events-none absolute bottom-full start-0 z-10 mb-1 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-xs font-semibold text-background shadow-sm group-hover:block group-active:block"
            >
              {name}
            </span>
          </span>
        ))}
      </span>
    </span>
  )
}
