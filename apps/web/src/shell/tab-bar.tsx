import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import type { IconRole } from '../components/ui/icon-registry.js'
import { Icon } from '../components/ui/icon.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { CONTENT_COLUMN } from './frame.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The two everyday surfaces, in bar order. The list is role-invariant by design (PRD,
// story 6): every staff member sees exactly Tasks and Assistant, and role-gated
// surfaces live behind the header, never as a third tab. Each carries its destination
// icon role (iconography.md): the first place the reserved `fill` active-weight fires.
const tabs = [
  { to: '/tasks', labelKey: 'tabTasks', icon: 'tasks' },
  { to: '/assistant', labelKey: 'tabAssistant', icon: 'assistant' },
] as const satisfies ReadonlyArray<{ to: string; labelKey: string; icon: IconRole }>

// The bottom tab bar. Active state is derived from the URL by NavLink, not from
// tab-local state (PRD, story 3), so a deep link and a browser-back both light the
// correct tab; NavLink also stamps aria-current="page" on the active tab for us. The
// bar sits in flow at the bottom of the viewport-pinned shell column — the content
// region above it is the scroll container, so the bar never moves — and pads past the
// phone's home indicator via safe-area-inset-bottom (story 7). Its inner row shares the
// content column's max-width so the tabs line up under the content on a wide screen.
export function TabBar({ className }: { className?: string }) {
  const t = useTranslations('common')
  // The Tasks tab's new-assignments count (#136). Hidden while Tasks is the active tab — on the
  // board, the visit itself is the acknowledgement, so a badge there would only nag.
  const unseen = useUnseenTasksCount()
  return (
    <nav
      aria-label={t('primaryNav')}
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
                  'flex min-h-[44px] flex-col items-center justify-center gap-1 px-2 py-2 text-sm font-medium',
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
