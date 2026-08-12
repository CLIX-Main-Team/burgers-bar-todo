import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../components/ui/icon.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { destinationsFor } from './destinations.js'
import { CONTENT_COLUMN } from './frame.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The bottom tab bar, drawing the shared destinations list (destinations.ts) the desktop
// side nav uses — including the role-gated People/Locations rows (owner call 2026-08: a
// manager or admin on a phone reaches every surface from the bar, not through the account
// menu). An employee still sees exactly Tasks and Assistant (PRD story 6). Active state is
// derived from the URL by NavLink, not from tab-local state (PRD, story 3), so a deep link
// and a browser-back both light the correct tab; NavLink also stamps aria-current="page" on
// the active tab for us. The bar sits in flow at the bottom of the viewport-pinned shell
// column — the content region above it is the scroll container, so the bar never moves —
// and pads past the phone's home indicator via safe-area-inset-bottom (story 7). Its inner
// row shares the content column's max-width so the tabs line up under the content on a wide
// screen.
export function TabBar({
  principal,
  className,
}: { principal: PrincipalResponse; className?: string }) {
  const t = useTranslations()
  // The Tasks tab's new-assignments count (#136). Hidden while Tasks is the active tab — on the
  // board, the visit itself is the acknowledgement, so a badge there would only nag.
  const unseen = useUnseenTasksCount()
  const tabs = destinationsFor(principal)
  return (
    <nav
      aria-label={t('common.primaryNav')}
      className={cn(
        'border-t border-border bg-card shadow-sm pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      <ul className={cn(CONTENT_COLUMN, 'flex')}>
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[44px] flex-col items-center justify-center gap-1 px-1 py-2 text-sm font-medium',
                  // Active reads through the accent-foreground label plus the blue primary
                  // dot below; inactive is muted (components.md BottomNav, ui-flow).
                  isActive ? 'text-accent-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The destination icon carries the second, non-colour active signal
                      (iconography.md Weight): outline at rest, solid `fill` when active,
                      under the blue primary dot. Decorative — the label names the link.
                      The Tasks icon corner carries the new-assignments pill (#136), floated
                      with logical `end` so it mirrors in RTL. */}
                  <span className="relative">
                    <Icon name={tab.icon} size="lg" active={isActive} />
                    {tab.to === '/tasks' && !isActive && unseen > 0 ? (
                      <UnseenTasksBadge count={unseen} className="absolute -top-1.5 -end-3" />
                    ) : null}
                  </span>
                  <span>{t(tab.labelKey)}</span>
                  {/* The active dot is gold in both themes (design refresh 2026-08-12) — the
                      same thread the side nav's marker and the tab underline carry — not the
                      primary fill, which is ink by day. */}
                  <span
                    aria-hidden="true"
                    className={cn('size-1.5 rounded-full', isActive ? 'bg-gold' : 'bg-transparent')}
                  />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
