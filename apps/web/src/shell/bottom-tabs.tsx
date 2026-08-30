import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../components/ui/icon.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { tabsFor } from './destinations.js'
import { TAB_LABEL, TAB_PILL, TAB_SLOT } from './tab-slot.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The phone's primary navigation, below `md` only. It replaces the 80px side rail that used
// to run down every width, which cost a 390px phone 20.5% of its inline space and left each
// screen 278px to lay a dashboard out in. The bar spends the cheap axis instead: a phone
// scrolls vertically, so 56px of height is worth far more than 80px of width, and every
// screen gets its full measure back (owner report 2026-08-30).
//
// It is also what both platforms prescribe at this width. Material 3 puts destinations in a
// navigation bar below 600dp and reserves the rail for 600dp and up, and Apple's HIG puts
// them in a bottom tab bar within thumb reach. The rail was a tablet pattern running on a
// phone.
//
// One active state still, not two: the rail is `hidden` below `md` and this bar is hidden
// from `md`, so exactly one of them is ever mounted and there is never a pair of highlights
// that have to agree.
//
// Cell budget: at most five, which is the ceiling every guideline puts on a bottom bar and
// what the owner asked for after reading the six-cell version as too busy (2026-08-30). The
// last cell is always More, so four destinations reach the bar directly and the rest fall into
// More's sheet alongside the management rows and settings.
//
// Which four is positional, not a fixed list, because the Access page lets the owner change
// what each role holds at run time (destinations.ts). A role with three pages gets a four-cell
// bar; a role with six gets four plus More. Both lay out, because the cells are `flex-1`.

export function BottomTabs({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()

  // The Tasks slot's new-assignments count (#136), hidden while Tasks is current: on the
  // board, the visit is the acknowledgement.
  const unseen = useUnseenTasksCount()

  const rows = tabsFor(principal)

  return (
    <nav
      data-testid="bottom-tabs"
      aria-label={t('common.primaryNav')}
      className={cn(
        'flex flex-none border-t border-nav-border bg-nav-surface md:hidden',
        // The bar is the thing touching the bottom of the screen, so the bar pays for the
        // home indicator and the gesture bar. Padding rather than height: the insets sit
        // under the row, so the slots keep their full 44px+ target above them.
        // An app targeting Android 16 cannot opt out of edge-to-edge, and viewport-fit=cover
        // asks iOS for the same, so without this the last row of glyphs sits under the
        // gesture bar (--bb-safe-*, index.css).
        'pb-[var(--bb-safe-bottom)]',
      )}
    >
      {rows.map((row) => (
        <NavLink
          key={row.to}
          to={row.to}
          className={({ isActive }) => cn(TAB_SLOT, isActive ? 'text-nav-ink' : 'text-nav-muted')}
        >
          {({ isActive }) => (
            <>
              {/* Decorative: the label under it names the link. */}
              <span
                className={cn(TAB_PILL, isActive && 'bg-nav-selected text-nav-selected-ink')}
                aria-hidden="true"
              >
                <Icon name={row.icon} size="lg" active={isActive} />
              </span>
              <span className={TAB_LABEL}>{t(row.labelKey)}</span>
              {row.to === '/tasks' && !isActive && unseen > 0 ? (
                <UnseenTasksBadge count={unseen} className="absolute top-0.5 end-1.5" />
              ) : null}
            </>
          )}
        </NavLink>
      ))}

      {/* More, always the last cell. It is the account menu wearing the bar's slot: one sheet
          carries the overflow destinations, the management rows, the settings and logout, so
          there is no second panel to keep in step with the rail's. */}
      <AccountMenu principal={principal} variant="tab" />
    </nav>
  )
}
