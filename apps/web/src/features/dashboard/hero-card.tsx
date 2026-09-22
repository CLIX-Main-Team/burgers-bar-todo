import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { CARD_SURFACE } from '../../components/ui/surfaces.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { ENTER } from './dashboard-card.js'
import { OrderRail } from './order-rail.js'

// The number the page leads with: how much open work there is, and the two parts of it that ask
// for something today (round 3, 2026-09-22).
//
// The first cut filled the whole card with the action blue ("too much for being blue … can't you
// make it subtle?") and the second drew the reference dashboards' ripple of rings ("looks like a
// data or wifi connection"). So the card wears the same surface as every other card, the figure
// is in ink, and the picture behind it is the kitchen's own: the order rail, with a ticket per
// job still open (order-rail.tsx).
//
// The whole card is one link to the board, because the only thing to do with "88 open tasks" is
// go and look at them.

export function HeroCard({
  open,
  overdue,
  dueToday,
  delay,
  className,
}: {
  open: number
  overdue: number
  dueToday: number
  delay: number
  className?: string
}) {
  const t = useTranslations()
  const calm = overdue === 0 && dueToday === 0

  return (
    <Link
      to="/tasks"
      className={cn(
        CARD_SURFACE,
        'group relative isolate flex min-h-[13rem] flex-col overflow-hidden p-5 transition-colors md:p-6',
        'hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        ENTER,
        className,
      )}
      style={delayStyle(delay)}
    >
      {/* The rail sits in the card's top corner at the inline end and runs off its edge, beside
          the label and the figure rather than over them: it takes a share of the card's width,
          never a fixed size, so on a narrow card the tickets shrink instead of reaching the
          figure. It sits behind the text either way. */}
      <OrderRail
        open={open}
        overdue={overdue}
        dueToday={dueToday}
        delay={delay}
        className="pointer-events-none absolute -end-3 top-5 -z-10 w-[min(52%,16rem)] md:top-6"
      />

      <p className="text-label font-semibold text-muted-foreground">{t('dashboard.heroTitle')}</p>
      <p className="mt-3 text-figure-lg font-bold text-foreground">{open}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-label font-semibold">
        {calm ? (
          <span className="rounded-full bg-success-muted px-2.5 py-1 text-success-muted-foreground">
            {t('dashboard.heroCalm')}
          </span>
        ) : null}
        {overdue > 0 ? (
          <span className="rounded-full bg-destructive-muted px-2.5 py-1 text-destructive-muted-foreground">
            {t('dashboard.heroOverdue', { count: overdue })}
          </span>
        ) : null}
        {dueToday > 0 ? (
          <span className="rounded-full bg-warning-muted px-2.5 py-1 text-warning-muted-foreground">
            {t('dashboard.heroDueToday', { count: dueToday })}
          </span>
        ) : null}
      </div>

      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-label font-semibold text-link">
        {t('dashboard.openBoard')}
        <Icon
          name="row-forward"
          size="sm"
          className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5"
        />
      </span>
    </Link>
  )
}
