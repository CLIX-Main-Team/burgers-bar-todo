import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { cn } from '../lib/cn.js'
import { CONTENT_COLUMN } from './frame.js'

// The two everyday surfaces, in bar order. The list is role-invariant by design (PRD,
// story 6): every staff member sees exactly Tasks and Assistant, and role-gated
// surfaces live behind the header, never as a third tab.
const tabs = [
  { to: '/tasks', labelKey: 'tabTasks' },
  { to: '/assistant', labelKey: 'tabAssistant' },
] as const

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
      className="sticky bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={cn(CONTENT_COLUMN, 'flex')}>
        {tabs.map((tab) => (
          <li key={tab.to} className="flex-1">
            <NavLink
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'flex min-h-[44px] items-center justify-center px-2 py-2 text-sm font-medium',
                  isActive ? 'text-slate-900' : 'text-slate-500',
                )
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
