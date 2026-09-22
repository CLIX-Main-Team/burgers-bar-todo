import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { CARD_SURFACE, ENTER } from './dashboard-card.js'

// The number the page leads with: how much open work there is, and the two parts of it that ask
// for something today (round 3, 2026-09-22).
//
// Its shape is the reference dashboards' hero, a big figure with a ripple of rings behind it.
// The first cut filled the whole card with the action blue and the owner called it "too much for
// being blue … can't you make it subtle?", so the card now wears the same surface as every other
// card, the figure is in ink, and the blue is spent only as a faint glow and the rings' thin
// strokes. The rings are drawn as broken arcs, a nest of brackets, which is the Burgers Bar mark's
// own punctuation: the reference's ripple, in this brand's hand.
//
// The whole card is one link to the board, because the only thing to do with "88 open tasks" is
// go and look at them.

const RINGS = [36, 64, 92, 120, 148, 176]

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
      {/* The ripple sits at the inline end, so it mirrors with the reading direction; the rings
          themselves are symmetric and need no flip. Decorative, so hidden from assistive tech. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -end-28 top-1/2 -z-10 size-[22rem] -translate-y-1/2"
      >
        <span className="absolute inset-0 rounded-full bg-[image:var(--bb-hero-glow)]" />
        <svg aria-hidden="true" viewBox="-180 -180 360 360" className="absolute inset-0 size-full">
          {RINGS.map((radius, index) => {
            const circumference = 2 * Math.PI * radius
            const arc = circumference * 0.38
            const gap = circumference * 0.12
            return (
              <circle
                key={radius}
                r={radius}
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${arc} ${gap}`}
                // Centres each bracket on three and nine o'clock, so the gaps fall at twelve and
                // six and the nest reads as ( ( ( ) ) ) rather than as a dashed circle.
                strokeDashoffset={arc / 2}
                className="stroke-primary motion-safe:animate-settle"
                style={{
                  strokeOpacity: 0.16 - index * 0.022,
                  ...delayStyle(delay + 120 + index * 70),
                }}
              />
            )
          })}
        </svg>
      </span>

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
