import { useTranslations } from 'use-intl'

// Placeholder Assistant screen. It holds the `/assistant` route inside the shell's
// Outlet until the Assistant lands (Ticket #57). Kept as thin as the Tasks placeholder
// so the shell can be exercised end to end without pulling either feature forward.
export function AssistantScreen() {
  const t = useTranslations('assistant')
  return (
    <section>
      <h1 className="text-lg font-semibold text-slate-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('comingSoon')}</p>
    </section>
  )
}
