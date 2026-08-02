import { useMutation } from '@tanstack/react-query'
import { Link, Outlet } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { Button } from '../components/ui/button.js'
import { roleLabelKey } from '../i18n/labels.js'
import { cn } from '../lib/cn.js'
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
// The avatar account menu is a later slice (Ticket 2); until it lands the header keeps
// the existing inline actions so a manager does not lose access: the language toggle,
// log out, log out of all devices, and a plain Manage-users link for managers/admins.
export function AppLayout() {
  const t = useTranslations()
  const { principal, signOut, signOutAll } = useSession()

  const logout = useMutation({ mutationFn: signOut })
  const logoutAll = useMutation({ mutationFn: signOutAll })
  const busy = logout.isPending || logoutAll.isPending

  // RequireAuth guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  // UI-only gating (ADR-0007): showing the link is a convenience, not the boundary —
  // the API authorises every /people request regardless of what the header renders.
  const canProvision = principal.role === 'admin' || principal.role === 'manager'

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white pt-[env(safe-area-inset-top)]">
        <div
          className={cn(CONTENT_COLUMN, 'flex flex-wrap items-center justify-between gap-2 p-4')}
        >
          <div>
            <p className="font-semibold text-slate-900">{t('common.appName')}</p>
            <p className="text-xs text-slate-500">
              {t('app.signedInAs', { role: t(roleLabelKey(principal.role)) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageToggle />
            {canProvision && (
              <Link
                to="/people"
                className="inline-flex min-h-[44px] items-center rounded-md px-2 text-sm font-medium text-slate-600 underline-offset-2 hover:underline"
              >
                {t('app.manageUsers')}
              </Link>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => logout.mutate()}>
              {t('app.logout')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => logoutAll.mutate()}>
              {t('app.logoutAll')}
            </Button>
          </div>
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
