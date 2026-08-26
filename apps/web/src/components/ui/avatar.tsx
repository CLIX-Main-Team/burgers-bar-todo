import { cn } from '../../lib/cn.js'
import { avatarTone } from './avatar-color.js'

// A person's initials in a circle (issue #213, components.md §Avatar): the assignee mark on
// a task card. There are no uploaded photos in v1, so the initials ARE the component — and
// since 2026-08-21 they sit on a per-person colour rather than the one shared `accent` ground,
// picked by hashing the name (avatar-color.ts). A wall of identical discs made every assignee
// look the same at 23px; a colour lets the eye find a person before it reads a letter. A single avatar is decorative on its own; the
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
        'inline-grid size-7 place-items-center rounded-full text-caption font-semibold',
        avatarTone(name),
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
  max,
  overflowLabel,
  className,
}: {
  names: string[]
  // The screen-reader phrasing, e.g. "Assigned to" — the caller owns the localised word.
  label: string
  // Cap the discs and roll the rest into a +N (owner ask 2026-08-26, for the branch boxes,
  // where a branch's whole headcount would otherwise draw thirty circles across a card).
  // Absent means no cap, which is what a task card wants: it has three assignees, not thirty.
  max?: number
  // What the +N announces to a screen reader, e.g. "3 more". Required only when `max` is.
  overflowLabel?: string
  className?: string
}) {
  if (names.length === 0) return null
  // The cap counts faces, and the +N sits beside them rather than in the last face's slot —
  // four names under a cap of three read as three faces and a "+1", never as two faces and a
  // "+2", which would hide somebody the card had the room for.
  const shown = max !== undefined && names.length > max ? names.slice(0, max) : names
  const hidden = names.slice(shown.length)
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
        {shown.map((name, index) => (
          <span
            // Names can repeat, so pair the name with its slot for a stable key. The stack is a
            // static, non-reordering, stateless display, so the slot index is a safe identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: static, stateless avatar list — names may repeat, so the slot disambiguates.
            key={`${name}-${index}`}
            className={cn('group relative select-none', index > 0 && '-ms-1.5')}
          >
            {/* Card-scale discs (The Counter, 2026-08-14): 23px with 9.5px initials —
                a quiet meta-row mark, a size under the default the People screen keeps. */}
            <Avatar name={name} className="size-[23px] text-[0.59375rem] ring-2 ring-card" />
            {/* The name bubble: hung from the circle's inline-start edge and growing toward
                the inline-end — the stack sits at its row's inline-start, so a centred bubble
                on the first avatar clipped off the screen edge on a phone; anchored this way
                it always grows into the card. Foreground-on-background like a native tooltip,
                inert to the pointer so it never traps the hover that opened it. */}
            <span
              dir="auto"
              className="pointer-events-none absolute bottom-full start-0 z-10 mb-1 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-caption font-semibold text-background shadow-sm group-hover:block group-active:block"
            >
              {name}
            </span>
          </span>
        ))}
        {/* The overflow disc. It is a disc and not a "+3" in plain text so the row keeps one
            rhythm all the way across, and it carries the same bubble the faces do — the names
            it stands for are exactly the ones the card is not showing, which is the only
            reason somebody would reach for it. The bubble wraps here where a single name does
            not: eight names on one unbreakable line would run off the card. */}
        {hidden.length > 0 ? (
          <span className="group relative -ms-1.5 select-none">
            <span
              className={cn(
                'inline-grid size-[23px] place-items-center rounded-full text-[0.59375rem] font-semibold ring-2 ring-card',
                'bg-muted text-muted-foreground',
              )}
            >
              +{hidden.length}
            </span>
            <span
              dir="auto"
              className="pointer-events-none absolute bottom-full start-0 z-10 mb-1 hidden w-max max-w-[13rem] rounded-md bg-foreground px-2 py-0.5 text-caption font-semibold text-background shadow-sm group-hover:block group-active:block"
            >
              {hidden.join(', ')}
            </span>
          </span>
        ) : null}
      </span>
      {/* The +N is aria-hidden with the rest of the discs, so the count says itself here —
          the sr-only label above already read every name, cap or no cap. */}
      {hidden.length > 0 && overflowLabel ? <span className="sr-only">{overflowLabel}</span> : null}
    </span>
  )
}
