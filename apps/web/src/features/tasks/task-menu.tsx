import { type TaskStatus, taskStatusSchema } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { DropdownMenuLabel, DropdownMenuRadioItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { tasksApi } from '../../lib/api.js'
import { STATUS_ICON } from './board-columns.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The status-change write behind the card's "Move to…" menu — the accessible / touch
// equivalent of drag-between-lanes, and the one write an employee has (#213, components.md
// §StatusControl). The board is a single list in this slice, so status has no lane to name it;
// the menu is where the change lives. Every write refetches the acting user's board so their
// own view reflects it at once (other viewers get it over the live channel), and, like every
// write, the API stays the sole authority — it authorises by scope and writes only the status
// column, so this can only ever move a task the caller already owns.
export function useTaskStatusMutation(taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (status: TaskStatus) => tasksApi.updateTaskStatus(taskId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })
}

// The "Move to…" group inside a card's overflow menu: a section label above the three
// statuses as radio rows, the current one checked and disabled (moving to where it already is
// is a no-op). Presentational — the card owns the mutation and passes `onMove` — so both the
// manager and the employee card share one status affordance.
export function MoveToItems({
  status,
  onMove,
  disabled = false,
}: {
  status: TaskStatus
  onMove: (status: TaskStatus) => void
  disabled?: boolean
}) {
  const t = useTranslations()
  // The section heading names the radio group to assistive tech: the label carries the id, the
  // group points its aria-labelledby at it, so the three statuses read as "Move to" choices.
  const labelId = useId()
  return (
    // role="group" groups the menuitemradio rows under their heading inside the role="menu"
    // popover; a <fieldset> (the rule's suggestion) is a form-control container and is not
    // valid menu content.
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is not valid inside a role="menu"; role="group" is the correct ARIA grouping here.
    <div role="group" aria-labelledby={labelId}>
      <DropdownMenuLabel id={labelId}>{t('tasks.moveTo')}</DropdownMenuLabel>
      {taskStatusSchema.options.map((option) => {
        const current = option === status
        return (
          <DropdownMenuRadioItem
            key={option}
            checked={current}
            disabled={disabled || current}
            onSelect={() => onMove(option)}
          >
            {/* Decorative — the row's own label names the status. */}
            <Icon name={STATUS_ICON[option]} size="sm" active={current} />
            {t(taskStatusLabelKey(option))}
          </DropdownMenuRadioItem>
        )
      })}
    </div>
  )
}

// The overflow trigger every card shares: a ghost icon Button whose 44px square holds a small
// `dots-three` glyph, so the tap area clears the touch floor while the resting control is just
// the quiet glyph (components.md §TaskCard). The label names the task so a screen-reader user
// knows which card's actions they opened.
export function overflowTrigger(label: string) {
  return function TriggerButton(props: {
    ref: (node: HTMLButtonElement | null) => void
    onClick: () => void
    'aria-haspopup': 'menu'
    'aria-expanded': boolean
  }) {
    return (
      <Button {...props} variant="ghost" size="icon" aria-label={label}>
        <Icon name="overflow" />
      </Button>
    )
  }
}
