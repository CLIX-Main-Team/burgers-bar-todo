import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../components/ui/icon.js'
import { Wordmark } from '../components/wordmark.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { destinationsFor } from './destinations.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The desktop side nav — the chrome the mobile bottom tab-bar and header become at `md`
// (shell spec #175). The rows come from the shared destinations list (destinations.ts) the
// mobile tab bar draws from too, so the two shells can never disagree on order or gating.
//
// Brand black in BOTH themes (design refresh 2026-08-12 — the menu board on the wall, the
// one declared aesthetic risk of the refresh): the surface and inks are the fixed nav-*
// primitives, not the theme tokens, so day and night stand the app on the same black anchor
// with the gold marking where you are.
//
// Three stacked zones: the wordmark, the nav list, and the account foot. Everything is
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
      className="hidden border-nav-border bg-nav-surface md:flex md:h-dvh md:w-[var(--bb-sidenav)] md:flex-none md:flex-col md:gap-2 md:border-e md:px-3 md:py-4"
    >
      {/* The wordmark opens the black board (design refresh 2026-08-12) — the full BURGERSBAR
          device in the fixed nav inks, replacing the bare ( B ) + text lockup. Not a link;
          the destinations own navigation. */}
      <Wordmark tone="nav" className="px-2.5 pt-2 pb-4 text-[1rem]" />

      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.to}>
            <NavLink
              to={row.to}
              className={({ isActive }) =>
                cn(
                  // 40px rows at 14px medium (The Counter, 2026-08-14 — the artifact rail's
                  // own measure): the menu board lists its destinations quietly, a step
                  // under the touch floor on this pointer-first surface.
                  'relative flex h-10 items-center gap-[11px] rounded-md px-2.5 text-body font-medium',
                  'hover:bg-white/5 hover:text-nav-ink',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold',
                  // Active carries the gold wash + full ink; the gold marker and fill-weight
                  // icon below are the second, non-colour signals.
                  isActive ? 'bg-nav-active font-semibold text-nav-ink' : 'text-nav-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The gold inline-start marker bar — sits in the nav's inline padding
                      gutter, mirrors with the layout. Decorative. */}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute top-2 bottom-2 -start-[0.5625rem] w-[3px] rounded-full bg-nav-gold"
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
      <div className="mt-auto border-t border-nav-border pt-4">
        <AccountMenu principal={principal} placement="foot" />
      </div>
    </nav>
  )
}
