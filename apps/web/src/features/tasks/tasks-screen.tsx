import { useTranslations } from 'use-intl'

// Placeholder Tasks screen. It holds the `/tasks` route inside the shell's Outlet until
// the task board lands (Ticket #58), so the shell's navigation is a working tracer
// bullet now. Deliberately thin: a heading and a "coming soon" line, nothing to carry
// forward.
export function TasksScreen() {
  const t = useTranslations('tasks')
  return (
    <section>
      <h1 className="text-lg font-semibold text-slate-900">{t('title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('comingSoon')}</p>
    </section>
  )
}
