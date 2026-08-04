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
// avatars show visually.
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
    <span className={cn('inline-flex items-center', className)}>
      <span className="sr-only">
        {label} {names.join(', ')}
      </span>
      <span aria-hidden className="flex">
        {names.map((name, index) => (
          <Avatar
            // Names can repeat, so pair the name with its slot for a stable key. The stack is a
            // static, non-reordering, stateless display, so the slot index is a safe identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: static, stateless avatar list — names may repeat, so the slot disambiguates.
            key={`${name}-${index}`}
            name={name}
            className={cn('ring-2 ring-card', index > 0 && '-ms-2')}
          />
        ))}
      </span>
    </span>
  )
}
