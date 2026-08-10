import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { BrandMark } from '../components/brand-mark.js'
import { Icon } from '../components/ui/icon.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { destinationsFor } from './destinations.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The desktop side nav — the chrome the mobile bottom tab-bar and header become at `md`
// (shell spec #175). The rows come from the shared destinations list (destinations.ts) the
// mobile tab bar draws from too, so the two shells can never disagree on order or gating.
//
// Three stacked zones: a brand lockup, the nav list, and the account foot. Everything is
// laid out with logical properties (border-inline-end, inline-start marker, me/ps) so a
// single definition mirrors — the nav sits at the inline-start, the right in Hebrew and the
// left in English, with no direction-specific CSS.

export function SideNav({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()

  // The Tasks row's new-assignments count (#136) — the desktop twin of the tab-bar badge. Hidden
  // while Tasks is the active destination: on the board, the visit itself is the acknowledgement.
  const unseen = useUnseenTasksCount()

  const rows = destinationsFor(principal)

  return (
    <nav
      data-testid="side-nav"
      aria-label={t('common.primaryNav')}
      className="hidden border-border bg-card md:flex md:h-dvh md:w-[var(--bb-sidenav)] md:flex-none md:flex-col md:gap-2 md:border-e md:px-3 md:py-4"
    >
      {/* Brand lockup — the mark tile (brand-gradient ground, the site's cream ( B ) mark —
          a miniature of the site's header bar, brand assets ADR-0016) and the wordmark. Not a
          link; the destinations own navigation. */}
      <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-4">
        <span
          aria-hidden="true"
          className="grid size-8 flex-none place-items-center rounded-[0.5rem] bg-[image:var(--bb-gradient-brand)] text-[color:var(--bb-cream)]"
        >
          <BrandMark className="w-5" />
        </span>
        <span className="text-[1.125rem] font-semibold text-foreground">{t('common.appName')}</span>
      </div>

      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.to}>
            <NavLink
              to={row.to}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[var(--bb-control-height)] items-center gap-3 rounded-md px-2.5 font-medium',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // Active carries the accent surface + accent-foreground label; the blue
                  // marker and fill-weight icon below are the second, non-colour signals.
                  isActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The blue inline-start marker bar — sits in the nav's inline padding
                      gutter, mirrors with the layout. Decorative. */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-2 bottom-2 -start-[0.5625rem] w-[3px] rounded-full bg-primary"
                    />
                  )}
                  {/* The destination glyph carries the reserved `fill` active weight
                      (iconography.md); decorative — the label names the link. */}
                  <Icon name={row.icon} active={isActive} />
                  <span>{t(row.labelKey)}</span>
                  {/* The Tasks row seats the new-assignments pill (#136) at its inline end —
                      the room the vertical nav has that the tab bar's icon corner stands in for. */}
                  {row.to === '/tasks' && !isActive && unseen > 0 ? (
                    <UnseenTasksBadge count={unseen} className="ms-auto" />
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Account foot — pushed to the bottom, divided from the nav list. Opens the account
          menu rising from the foot (the desktop equivalent of the mobile popover). */}
      <div className="mt-auto border-t border-border pt-4">
        <AccountMenu principal={principal} placement="foot" />
      </div>
    </nav>
  )
}
