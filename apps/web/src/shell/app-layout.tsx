import { Outlet } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { CONTENT_COLUMN } from './frame.js'
import { TabBar } from './tab-bar.js'

// The navigational shell: the layout route at `/` that draws the app's chrome once and
// renders the routed feature screen into its Outlet (PRD, "the `/` route becomes a
// layout route"). It supersedes the placeholder app-shell.tsx, relocating the session
// touchpoints into this header and the people surface out to its own `/people` route.
//
// The frame is the one every feature inherits (PRD, stories 23–24): a single scrolling
// column capped at a readable width, a header that sticks to the top and clears the
// notch, and a fixed bottom tab bar that clears the home indicator. Feature screens
// render into the Outlet and never draw their own chrome. Authoring rules for anything
// rendered here: phone-first (~375px), single column, ~44px tap targets, no hover-only
// affordances, and logical Tailwind properties only (ms/me/ps/pe, text-start/end) so
// the layout flips with the `dir` the locale provider sets.
//
// The non-tab surfaces — identity, the language toggle, log out and log out of all
// devices, and Manage users for managers/admins — live behind the header avatar
// (Ticket 2, AccountMenu), not inline. The header itself carries only the app name and
// that avatar.
export function AppLayout() {
  const t = useTranslations()
  const { principal } = useSession()

  // RequireAuth guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div className={cn(CONTENT_COLUMN, 'flex items-center justify-between gap-2 p-4')}>
          <p className="font-semibold text-slate-900">{t('common.appName')}</p>
          <AccountMenu principal={principal} />
        </div>
      </header>

      <main className="flex-1">
        <div className={cn(CONTENT_COLUMN, 'p-4')}>
          <Outlet />
        </div>
      </main>

      <TabBar />
    </div>
  )
}
