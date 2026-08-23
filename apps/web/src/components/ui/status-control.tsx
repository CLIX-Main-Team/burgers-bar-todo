import { type TaskStatus, taskStatusSchema } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { STATUS_DOT, STATUS_ICON } from '../../features/tasks/board-columns.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { DropdownMenu, DropdownMenuRadioItem } from './dropdown-menu.js'
import { Icon } from './icon.js'

// The card's status affordance and the design-system's StatusControl (components.md
// §StatusControl, audit X5): the employee's sole write, and since the tabbed mobile board
// (owner decision 2026-08) also on manager/admin cards, one consistent control everywhere.
// Recut in the 2026-08-12 design refresh: an outlined chip in neutral ink — `[status dot]
// [status label] [caret]` — the pastel fill gone with the rest of the pastel status look.
// The chip is itself the control: tapping it opens a DropdownMenu of the three statuses, the
// current one checked, and selecting one drives the write. Presentational: the caller owns
// the mutation and passes `onSelect`, so any later screen that surfaces status inherits the
// chip without re-deriving its look, its dot, or its menu.
//
// The chip's dot and label come from the single status→dot (STATUS_DOT) and status→key
// (labels) maps, so it marks the status exactly the way the lane head and the mobile tabs
// do; the menu rows keep the status glyphs (STATUS_ICON) — there the mark is the row's
// identity, not an accent.

export function StatusControl({
  status,
  onSelect,
  label,
  disabled = false,
  variant = 'pill',
  size = 'caption',
}: {
  status: TaskStatus
  // Called with the chosen status; the caller writes it (tasksApi.updateTaskStatus).
  onSelect: (status: TaskStatus) => void
  // `pill` is the card's outlined chip. `bare` drops the outline and the caret and leans on the
  // hover ground instead — for a table column, where every row carries this control and an
  // outlined chip per row drew a second grid over the one the table already has (owner call
  // 2026-08-23).
  variant?: 'pill' | 'bare'
  // Which type scale the label takes. `caption` is the density of a card's meta row and a table
  // column; `body` is for a property sheet, where this value stands in a column beside the
  // priority, the people and the date and has to be set like them (owner call 2026-08-23).
  size?: 'caption' | 'body'
  // The accessible name of the menu (which task's status this changes) — the pill's own visible
  // status label names the trigger, so this names the popover the trigger opens.
  label: string
  // A write is in flight: the three rows are inert so a second move cannot race the first, the
  // way the overflow "Move to…" menu holds while its mutation settles. The pill itself stays
  // open-able — the status has not moved in the cache yet, so the current state still reads.
  disabled?: boolean
}) {
  const t = useTranslations()

  return (
    <DropdownMenu
      label={label}
      // The pill always sits at the inline-end of the card's footer row, so the menu hangs from
      // that same edge and opens back across the card. Anchored at its start it hung off the
      // card instead, and on a phone off the screen (owner report 2026-08-16).
      align="end"
      trigger={(props) => (
        // A transparent 44px-tall hit target (touch floor) wrapping a badge-sized visible pill,
        // so the tap area clears the minimum while the chip stays compact in the caption-scale
        // meta row (iconography.md: visual size is decoupled from the hit area the control owns).
        <button
          {...props}
          type="button"
          className="group inline-flex min-h-11 shrink-0 items-center rounded-md outline-none"
        >
          <span
            className={cn(
              'inline-flex items-center gap-1.5 font-semibold text-foreground transition',
              size === 'body' ? 'text-body' : 'text-caption',
              // Reads as interactive without a second colour: the chip takes the muted wash on
              // hover, dips and shrinks a hair when pressed (the tactile press the DS asks every
              // control to carry), and the focus ring hugs the visible chip, not the tall target.
              'group-hover:bg-muted group-active:bg-muted',
              'motion-safe:group-active:scale-[0.98]',
              'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background',
              variant === 'pill'
                ? // border-strong, not input (approved replica 2026-08-13): the chip is not a
                  // text field — its dot, label, and caret already say what it is, so it wears
                  // the mid boundary rather than an input's firmer line. rounded-md, not the
                  // badge's full circle (owner call 2026-08-23): on a card it stands beside the
                  // priority and branch chips, and one radius is what makes the three read as a
                  // set rather than as three separate ideas.
                  'rounded-md border border-border-strong bg-transparent px-[9px] py-[2.5px]'
                : 'rounded-md px-1.5 py-1',
            )}
          >
            {/* The status dot — decorative; the chip's own label names the status. */}
            <span
              aria-hidden="true"
              className={cn('size-[7px] rounded-full', STATUS_DOT[status])}
            />
            {t(taskStatusLabelKey(status))}
            {variant === 'pill' ? (
              <Icon name="disclosure" size="sm" className="text-muted-foreground" />
            ) : null}
          </span>
        </button>
      )}
    >
      {taskStatusSchema.options.map((option) => {
        const current = option === status
        return (
          <DropdownMenuRadioItem
            key={option}
            checked={current}
            // The current status is a no-op move, so it reads as checked but is inert; a write in
            // flight holds the rest until it settles.
            disabled={disabled || current}
            onSelect={() => onSelect(option)}
          >
            {/* The current row paints its glyph `fill` — the reserved selected signal. */}
            <Icon name={STATUS_ICON[option]} size="sm" active={current} />
            {t(taskStatusLabelKey(option))}
          </DropdownMenuRadioItem>
        )
      })}
    </DropdownMenu>
  )
}
