import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../components/ui/icon-registry.js'
import { Icon } from '../components/ui/icon.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'

// The desktop side nav — the chrome the mobile bottom tab-bar and header become at `md`
// (shell spec #175). This is the employee shell (ticket #208): the two role-invariant
// destinations (Tasks, Assistant, PRD story 6), a brand lockup, and the account foot, with
// no admin surfaces. Managers/admins still reach People and Locations through the account
// foot menu (the full menu, same as mobile); promoting those to their own role-gated nav
// rows — the room the vertical nav has that the two-tab thumb zone never did — is the next
// ticket (Ticket B), which then drops them from the foot. Mobile is untouched.
//
// Three stacked zones: a brand lockup, the nav list, and the account foot. Everything is
// laid out with logical properties (border-inline-end, inline-start marker, me/ps) so a
// single definition mirrors — the nav sits at the inline-start, the right in Hebrew and the
// left in English, with no direction-specific CSS.

interface NavRow {
  to: string
  labelKey: string
  icon: IconRole
}

// The two role-invariant destinations, in the same order as the mobile bar.
const ROWS: readonly NavRow[] = [
  { to: '/tasks', labelKey: 'common.tabTasks', icon: 'tasks' },
  { to: '/assistant', labelKey: 'common.tabAssistant', icon: 'assistant' },
]

export function SideNav({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()

  return (
    <nav
      data-testid="side-nav"
      aria-label={t('common.primaryNav')}
      className="hidden border-border bg-card md:flex md:h-dvh md:w-[var(--bb-sidenav)] md:flex-none md:flex-col md:gap-2 md:border-e md:px-3 md:py-4"
    >
      {/* Brand lockup — the mark tile (gold ground, ink letter, brand assets ADR-0016) and
          the wordmark. Not a link; the destinations own navigation. */}
      <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-4">
        <span
          aria-hidden="true"
          className="grid size-8 flex-none place-items-center rounded-[0.5rem] bg-primary text-[1.05rem] font-extrabold text-primary-foreground"
        >
          B
        </span>
        <span className="text-[1.125rem] font-semibold text-foreground">{t('common.appName')}</span>
      </div>

      <ul className="flex flex-col gap-1">
        {ROWS.map((row) => (
          <li key={row.to}>
            <NavLink
              to={row.to}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[var(--bb-control-height)] items-center gap-3 rounded-md px-2.5 font-medium',
                  'hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  // Active carries the accent surface + accent-foreground label; the gold
                  // marker and fill-weight icon below are the second, non-colour signals.
                  isActive ? 'bg-accent text-accent-foreground' : 'text-foreground',
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
                      className="absolute top-2 bottom-2 -start-[0.5625rem] w-[3px] rounded-full bg-primary"
                    />
                  )}
                  {/* The destination glyph carries the reserved `fill` active weight
                      (iconography.md); decorative — the label names the link. */}
                  <Icon name={row.icon} active={isActive} />
                  <span>{t(row.labelKey)}</span>
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
