import type { ReactNode } from 'react'
import { CARD_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'

// The pieces every card on the Dashboard is made of (round 3, 2026-09-22). The owner pointed at
// his coworkers' dashboards (AlexBase, Kol HaAm) as the house style: big soft cards, generous
// padding, big numbers, tiles sunk into a card, pill toggles. That shape is written once here so
// the seven cards cannot drift apart from one another; the two surfaces and the pill row moved
// to components/ui when the Tasks page took the same style.

// Every block rises the same 10px over the same arrival duration; only its delay differs, and
// the delays are one score in dashboard-screen.tsx.
export const ENTER = 'motion-safe:animate-rise'

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
