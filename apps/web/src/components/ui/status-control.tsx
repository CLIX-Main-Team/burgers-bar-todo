import { type TaskStatus, taskStatusSchema } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { STATUS_ICON, STATUS_TONE } from '../../features/tasks/board-columns.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { DropdownMenu, DropdownMenuRadioItem } from './dropdown-menu.js'
import { Icon } from './icon.js'

// The card's status affordance and the design-system's StatusControl (components.md
// §StatusControl, audit X5): the employee's sole write, and since the tabbed mobile board
// (owner decision 2026-08) also on manager/admin cards, one consistent control everywhere. A
// soft badge-button pill — `[status glyph] [status label]
// [caret]` — that is itself the control: tapping it opens a DropdownMenu of the three statuses,
// the current one checked, and selecting one drives the write. Presentational: the caller owns
// the mutation and passes `onSelect`, so any later screen that surfaces status inherits the pill
// without re-deriving its look, its glyphs, or its menu.
//
// The pill's surface, glyph, and label all come from the single status→tone (STATUS_TONE),
// status→glyph (STATUS_ICON), and status→key (labels) maps, so the pill wears the same colour,
// mark, and word the kanban lane head and the mobile status tabs do (owner call 2026-08: the
// CRM-board palette — orange not-started, blue in-progress, green done).

export function StatusControl({
  status,
  onSelect,
  label,
  disabled = false,
}: {
  status: TaskStatus
  // Called with the chosen status; the caller writes it (tasksApi.updateTaskStatus).
  onSelect: (status: TaskStatus) => void
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
      align="start"
      trigger={(props) => (
        // A transparent 44px-tall hit target (touch floor) wrapping a badge-sized visible pill,
        // so the tap area clears the minimum while the chip stays compact in the caption-scale
        // meta row (iconography.md: visual size is decoupled from the hit area the control owns).
        <button
          {...props}
          type="button"
          className="group inline-flex min-h-11 shrink-0 items-center rounded-full outline-none"
        >
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-input px-3 py-1 text-xs font-medium transition',
              // Reads as interactive without a second colour: the surface deepens on hover, dips
              // further and shrinks a hair when pressed (the tactile press the DS asks every
              // control to carry), and the focus ring hugs the visible pill, not the tall target.
              'group-hover:brightness-95 group-active:brightness-90 dark:group-hover:brightness-110 dark:group-active:brightness-125',
              'motion-safe:group-active:scale-[0.98]',
              'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background',
              STATUS_TONE[status],
            )}
          >
            {/* Decorative — the pill's own label names the status; the caret marks it as a
                disclosure. */}
            <Icon name={STATUS_ICON[status]} size="sm" />
            {t(taskStatusLabelKey(status))}
            <Icon name="disclosure" size="sm" />
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
