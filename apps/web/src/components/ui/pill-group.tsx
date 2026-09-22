import { cn } from '../../lib/cn.js'
import type { IconRole } from './icon-registry.js'
import { Icon } from './icon.js'

// A row of pill toggles: the dashboard's activity range, its chain card's lens and attention
// tabs, and the Tasks page's board/list switch. The chosen pill wears --selected-soft, the app's
// mark for a SECONDARY pick (owner call 2026-08-27: "a transparent black or something … so it
// doesn't get too much attention"); blue stays for what you act on and where you are. Built as
// the app's shared segmented pattern, a fieldset of aria-pressed buttons, the one the theme and
// language toggles use.
export function PillGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** Names the group to assistive tech. */
  label: string
  value: T
  options: { value: T; label: string; count?: number; title?: string; icon?: IconRole }[]
  onChange: (next: T) => void
  className?: string
}) {
  return (
    <fieldset
      aria-label={label}
      className={cn('m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0', className)}
    >
      {options.map((option) => {
        const chosen = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full border px-3 text-label font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
              chosen
                ? 'border-transparent bg-selected-soft text-foreground'
                : 'border-border-strong text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {option.icon ? <Icon name={option.icon} size="sm" className="flex-none" /> : null}
            {option.label}
            {option.count !== undefined ? (
              <span
                className={cn(
                  'inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-caption tabular-nums',
                  chosen ? 'bg-card text-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {option.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </fieldset>
  )
}
