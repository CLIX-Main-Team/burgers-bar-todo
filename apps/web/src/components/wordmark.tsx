import { useTranslations } from 'use-intl'
import { cn } from '../lib/cn.js'

// The BURGERSBAR wordmark as live type (design refresh 2026-08-12): the brand book's
// bold-BURGERS / light-BAR pairing held by the gold parentheses of the ( B ) mark. It is
// the client's logotype, not copy — Latin artwork in both locales, pinned dir="ltr" so the
// RTL shell never reverses the letter order — and announced to assistive tech as the app's
// name. `tone` picks the ink family: 'default' reads through the theme tokens; 'nav' pins
// the fixed black chrome's inks, since the side nav ignores the theme by design.
export function Wordmark({
  tone = 'default',
  className,
}: {
  tone?: 'default' | 'nav'
  className?: string
}) {
  const t = useTranslations()
  const nav = tone === 'nav'
  return (
    <span
      role="img"
      dir="ltr"
      aria-label={t('common.appName')}
      className={cn(
        'flex select-none items-baseline gap-[0.12em] tracking-[0.05em]',
        nav ? 'text-nav-ink' : 'text-foreground',
        className,
      )}
    >
      <span className={cn('font-light', nav ? 'text-nav-gold' : 'text-accent-foreground')}>(</span>
      <span className="font-extrabold">BURGERS</span>
      <span className="font-light">BAR</span>
      <span className={cn('font-light', nav ? 'text-nav-gold' : 'text-accent-foreground')}>)</span>
    </span>
  )
}
