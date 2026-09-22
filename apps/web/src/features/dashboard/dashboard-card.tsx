import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The pieces every card on the Dashboard is made of (round 3, 2026-09-22). The owner pointed at
// his coworkers' dashboards (AlexBase, Kol HaAm) as the house style: big soft cards, generous
// padding, big numbers, tiles sunk into a card, pill toggles. That shape is written once here so
// the seven cards cannot drift apart from one another.

// Every block rises the same 10px over the same arrival duration; only its delay differs, and
// the delays are one score in dashboard-screen.tsx.
export const ENTER = 'motion-safe:animate-rise'

// A card's corner is a size up from the rest of the app's 10-12px panels on purpose: these are
// the largest surfaces the app draws, and the reference screens round them at about 20px.
export const CARD_SURFACE = 'rounded-[1.25rem] border border-border bg-card shadow-sm'

// A tile inside a card. It sinks rather than lifts, so a card full of tiles reads as one surface
// holding several figures and not as cards stacked on cards.
export const TILE_SURFACE = 'rounded-[0.875rem] bg-surface-sunken'

export function DashboardCard({
  title,
  note,
  action,
  delay,
  className,
  children,
}: {
  title: string
  note?: string
  /** Whatever sits at the head's inline end: a range toggle, a search field, a link. */
  action?: ReactNode
  /** This card's place in the page's entrance, in ms. */
  delay: number
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(CARD_SURFACE, 'flex min-w-0 flex-col p-5 md:p-6', ENTER, className)}
      style={delayStyle(delay)}
    >
      <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
          {note ? <p className="mt-0.5 text-label text-muted-foreground">{note}</p> : null}
        </div>
        {action ? <div className="ms-auto flex items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

// A row of pill toggles: the activity range, the chain card's lens, the attention tabs. The
// chosen pill wears --selected-soft, the app's mark for a SECONDARY pick (owner call 2026-08-27:
// "a transparent black or something … so it doesn't get too much attention"); blue stays for
// what you act on and where you are. Built as the app's shared segmented pattern, a fieldset of
// aria-pressed buttons, the one the theme and language toggles use.
export function PillGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** Names the group to assistive tech. */
  label: string
  value: T
  options: { value: T; label: string; count?: number; title?: string }[]
  onChange: (next: T) => void
}) {
  return (
    <fieldset aria-label={label} className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
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

// The legend every chart with two or more series carries (dataviz: identity is never colour
// alone). The swatch carries the colour; the words stay in the text inks.
export function Legend({ items }: { items: { label: string; swatch: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-label text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', item.swatch)} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
