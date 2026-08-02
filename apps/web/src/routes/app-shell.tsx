import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { Button } from '../components/ui/button.js'
import { PeopleManagement } from '../features/people/people-management.js'
import { roleLabelKey } from '../i18n/labels.js'

// The in-app surface reached after sign-in. In this feature it carries the session
// touchpoints (log out, log out of all devices) and — for an Admin or Manager — the
// people/provisioning surface. The task board and Assistant are later features, so an
// Employee sees only the shell and a placeholder. Language stays toggleable in-app,
// since a signed-in user may still switch it (ui-flow, session touchpoints).
export function AppShell() {
  const t = useTranslations()
  const { principal, signOut, signOutAll } = useSession()

  const logout = useMutation({ mutationFn: signOut })
  const logoutAll = useMutation({ mutationFn: signOutAll })
  const busy = logout.isPending || logoutAll.isPending

  // The guard guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  const canProvision = principal.role === 'admin' || principal.role === 'manager'

  return (
    <div className="min-h-dvh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold text-slate-900">{t('common.appName')}</p>
            <p className="text-xs text-slate-500">
              {t('app.signedInAs', { role: t(roleLabelKey(principal.role)) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageToggle />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => logout.mutate()}>
              {t('app.logout')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => logoutAll.mutate()}>
              {t('app.logoutAll')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        {canProvision ? (
          <PeopleManagement principal={principal} />
        ) : (
          <p className="text-sm text-slate-500">{t('app.nothingHere')}</p>
        )}
      </main>
    </div>
  )
}
