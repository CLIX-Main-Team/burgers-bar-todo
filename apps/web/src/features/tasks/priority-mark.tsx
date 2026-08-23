import type { TaskPriority } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { priorityPill } from './priority.js'

// How a task wears its priority wherever it is scanned among others — the board card and the
// list row (owner call 2026-08-23). The word came off: on a card the label repeated what the
// colour already said, and three priorities at three different label widths made a ragged rail.
// What is left is the flag on its own soft ground, one fixed square whatever the priority.
//
// Normal is drawn too, where before it drew nothing. Icon-only, the mark reads as a slot in a
// ladder rather than as a badge stuck on the urgent ones, and a ladder needs its floor visible
// to be read at all: a card with no mark now means a card still loading, not an ordinary task.
//
// The name is not lost with the word. It rides in the CSS-only tooltip the avatar stack uses —
// :hover for a pointer, :active for a phone's press-and-hold, no JS — and in sr-only text, so a
// screen reader hears the priority the sighted reader sees in the colour.
export function PriorityMark({
  priority,
  className,
}: {
  priority: TaskPriority
  className?: string
}) {
  const t = useTranslations()
  // "Priority: High" rather than "High": the flag alone does not say what the word is naming,
  // and a tooltip is read out of context by whoever hovers it.
  const name = t('tasks.priorityNamed', { value: t(taskPriorityLabelKey(priority)) })

  return (
    <span
      // The priority in the DOM, where the visible mark is a colour and a glyph: it names the
      // state for a stylesheet and for a test without either having to read a class list.
      data-priority={priority}
      // `relative` anchors the bubble AND lifts the mark above the row-wide click target the
      // title stretches over it — without that the overlay takes the hover and the tooltip
      // never opens.
      className={cn(
        'group relative flex size-6 flex-none items-center justify-center rounded-md',
        priorityPill(priority),
        className,
      )}
    >
      <Icon name="priority" size="sm" active={priority === 'high'} />
      <span className="sr-only">{name}</span>
      {/* Hung BELOW the mark and growing toward the inline-start: the mark sits at the top
          inline-end of a card, so a bubble above it would open past the card's own edge and be
          clipped by the lane that scrolls. Inert to the pointer, so it never traps the hover
          that opened it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-full end-0 z-20 mt-1 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-caption font-semibold text-background shadow-sm group-hover:block group-active:block"
      >
        {name}
      </span>
    </span>
  )
}
