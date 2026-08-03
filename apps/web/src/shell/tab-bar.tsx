import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../components/ui/icon-registry.js'
import { Icon } from '../components/ui/icon.js'
import { cn } from '../lib/cn.js'
import { CONTENT_COLUMN } from './frame.js'

// The two everyday surfaces, in bar order. The list is role-invariant by design (PRD,
// story 6): every staff member sees exactly Tasks and Assistant, and role-gated
// surfaces live behind the header, never as a third tab. Each carries its destination
// icon role (iconography.md): the first place the reserved `fill` active-weight fires.
const tabs = [
  { to: '/tasks', labelKey: 'tabTasks', icon: 'tasks' },
  { to: '/assistant', labelKey: 'tabAssistant', icon: 'assistant' },
] as const satisfies ReadonlyArray<{ to: string; labelKey: string; icon: IconRole }>

// The fixed bottom tab bar. Active state is derived from the URL by NavLink, not from
// tab-local state (PRD, story 3), so a deep link and a browser-back both light the
// correct tab; NavLink also stamps aria-current="page" on the active tab for us. The
// bar sticks to the bottom of the scrolling column and pads past the phone's home
// indicator via safe-area-inset-bottom (story 7). Its inner row shares the content
// column's max-width so the tabs line up under the content on a wide screen.
export function TabBar() {
  const t = useTranslations('common')
  return (
    <nav
      aria-label={t('primaryNav')}
      className="sticky bottom-0 z-10 border-t border-border bg-card shadow-sm pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={cn(CONTENT_COLUMN, 'flex')}>
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[44px] flex-col items-center justify-center gap-1 px-2 py-2 text-sm font-medium',
                  // Active reads through the accent-foreground label plus the gold primary
                  // dot below; inactive is muted (components.md BottomNav, ui-flow).
                  isActive ? 'text-accent-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The destination icon carries the second, non-colour active signal
                      (iconography.md Weight): outline at rest, solid `fill` when active,
                      under the gold primary dot. Decorative — the label names the link. */}
                  <Icon name={tab.icon} size="lg" active={isActive} />
                  <span>{t(tab.labelKey)}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 rounded-full',
                      isActive ? 'bg-primary' : 'bg-transparent',
                    )}
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
