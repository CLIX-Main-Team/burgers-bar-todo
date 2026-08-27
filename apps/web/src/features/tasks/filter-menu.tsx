import type { ReactNode } from 'react'
import { Avatar } from '../../components/ui/avatar.js'
import { DropdownMenu, DropdownMenuRadioItem } from '../../components/ui/dropdown-menu.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { ANY_FILTER } from './task-filters.js'

// The board's filter control (owner ask 2026-08-21: "the design is a bit plain").
//
// It replaces three form-shaped Selects that all sat there reading "All branches" / "Anyone"
// whether or not anything was chosen. Two things were wrong with that. A form field says "fill
// me in" and a filter says "narrow this", and they should not look alike. And an unset select
// looks exactly as full as a set one, so the bar could not answer the only question it is
// really asked: is this board showing me everything?
//
// So a filter here has two visibly different states rather than two different labels:
//
//   unset   a dashed outline holding the FACET's name — Branch, Role, Person — in muted ink.
//           Dashed is the whole idea: an empty slot, drawn the way a dotted line has meant
//           "nothing here yet" since paper forms. It is used nowhere else in this app, so it
//           carries the meaning without colliding with anything.
//   set     a solid outline holding the VALUE — the branch name, the person's face and name —
//           in full ink, and the trailing chevron turns into a × that clears it in one press.
//
// The two states are drawn at EXACTLY the same size (owner call, same day: "when I select
// something across the filters, it changes the size, I don't like it"). Every chip is one fixed
// box: a long value truncates instead of stretching the control, and the × takes over the
// chevron's reserved slot rather than being added beside it. Choosing a filter changes what the
// bar says and never where anything sits.
//
// Everything anchored, dismissed, flipped and keyboard-driven by the shared DropdownMenu — the
// same primitive the card's status pill uses, so the panels behave identically and nothing
// about popovers is reimplemented here.

export interface FilterChoice {
  value: string
  label: string
  // Drawn at the row's inline-start. A person passes their coloured disc, a branch or a role
  // passes a glyph, so the panel is scannable before it is read.
  lead?: ReactNode
  // The quiet second column at the row's inline-end — a person's role, say.
  meta?: string
}

// One size for all three, so they read as a set of slots rather than three controls that happen
// to sit together. The height and the caption scale match the view switcher beside them, which
// is what the rest of this toolbar row is drawn at.
const CHIP = 'h-8 w-[9.75rem]'

export function FilterMenu({
  facet,
  icon,
  value,
  choices,
  anyLabel,
  onChange,
  clearLabel,
}: {
  /** The facet's own name, shown while nothing is chosen: Branch, Role, Person. */
  facet: string
  icon: IconRole
  value: string
  choices: FilterChoice[]
  /** The reset row's wording — "Any branch", "Anyone". */
  anyLabel: string
  onChange: (next: string) => void
  /** Names the × to assistive tech, e.g. "Clear the Branch filter". */
  clearLabel: string
}) {
  const chosen = value === ANY_FILTER ? undefined : choices.find((choice) => choice.value === value)
  const active = chosen !== undefined

  return (
    <span className={cn('relative inline-flex', CHIP)}>
      <DropdownMenu
        label={facet}
        align="start"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className={cn(
              CHIP,
              // pe-7 reserves the slot the chevron or the × sits in. Reserving it in BOTH states
              // is what keeps the box from resizing when a value lands in it.
              'flex items-center gap-1.5 rounded-md ps-2.5 pe-7 text-caption font-semibold whitespace-nowrap transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              // Both states are a solid chip on the card surface (owner call 2026-08-27). The
              // resting state used to be a DASHED outline over the bare canvas, which at
              // --border-strong measures 1.47:1 there — the chip read as floating grey text
              // rather than something pressable, and the dashed edge was carrying a "nothing
              // chosen yet" hint that the placeholder label already says in words.
              // The two states now differ by ink and lift, not by whether the chip exists.
              'border border-border-strong bg-card shadow-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* The choice's own mark REPLACES the facet glyph rather than joining it: a chosen
                branch already carries the storefront, and a chosen person's face says "person"
                better than a generic account outline standing beside it. */}
            {chosen?.lead ?? (
              <Icon name={icon} size="sm" className="shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate" dir="auto">
              {chosen ? chosen.label : facet}
            </span>
          </button>
        )}
      >
        <FilterRows value={value} choices={choices} anyLabel={anyLabel} onChange={onChange} />
      </DropdownMenu>

      {active ? (
        // The undo lives on the chip, because a filter you cannot see the end of is a filter you
        // forget you set. Reopening the panel to choose "Any branch" again is two decisions for
        // something that is one. It is a sibling rather than a nested button — nesting one inside
        // the trigger would be invalid — laid over the slot the chevron holds when nothing is
        // chosen, which is why the swap costs no width.
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange(ANY_FILTER)}
          className="absolute inset-y-0 end-0 z-10 flex w-7 items-center justify-center rounded-e-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Icon name="close" size="sm" />
        </button>
      ) : (
        <Icon
          name="disclosure"
          size="sm"
          className="pointer-events-none absolute inset-y-0 end-2 my-auto text-muted-foreground opacity-70"
        />
      )}
    </span>
  )
}

// Split out so the menu's children are one element: the reset row, a rule, then the choices.
function FilterRows({
  value,
  choices,
  anyLabel,
  onChange,
}: {
  value: string
  choices: FilterChoice[]
  anyLabel: string
  onChange: (next: string) => void
}) {
  return (
    <div className="w-[15.5rem] max-w-[calc(100vw-2.5rem)]">
      {/* No check column on any row (owner call 2026-08-21): every row here is a choice from one
          set and one of them is always chosen, so a reserved tick slot only indents the whole
          menu to mark what the accent surface already marks. aria-checked is untouched. */}
      <DropdownMenuRadioItem
        checked={value === ANY_FILTER}
        onSelect={() => onChange(ANY_FILTER)}
        hideCheck
      >
        <span className="truncate">{anyLabel}</span>
      </DropdownMenuRadioItem>

      <hr className="my-1 h-px border-0 bg-border" />

      {/* The panel scrolls rather than growing past the fold: a chain of twenty people is a
          realistic list, and a menu taller than the viewport cannot be dismissed by pointing
          away from it. */}
      <div className="max-h-[15rem] overflow-y-auto">
        {choices.map((choice) => (
          <DropdownMenuRadioItem
            key={choice.value}
            checked={value === choice.value}
            onSelect={() => onChange(choice.value)}
            hideCheck
          >
            {choice.lead}
            <span className="min-w-0 truncate" dir="auto">
              {choice.label}
            </span>
            {choice.meta ? (
              <span className="ms-auto shrink-0 ps-2 text-caption text-muted-foreground">
                {choice.meta}
              </span>
            ) : null}
          </DropdownMenuRadioItem>
        ))}
      </div>
    </div>
  )
}

// The person disc as it appears inside a chip and inside a menu row. Smaller than the card's,
// because here it rides beside text rather than standing alone in a meta row.
export function FilterAvatar({ name }: { name: string }) {
  return <Avatar name={name} className="size-[18px] flex-none text-[0.5625rem]" />
}
