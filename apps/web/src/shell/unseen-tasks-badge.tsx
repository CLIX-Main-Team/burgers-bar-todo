import { useTranslations } from 'use-intl'
import { CountBadge } from '../components/ui/count-badge.js'

// The new-assignments count pill on the Tasks destination (#136), shared by the mobile tab bar and
// the desktop side nav so the two shells can never disagree on what the count looks like or says.
// The disc and the red are CountBadge's; all this adds is what the number means. The caller decides
// when it shows (count > 0, destination not active) and where it sits: the tab bar floats it off
// the icon corner, the side nav seats it at the row's inline end.
export function UnseenTasksBadge({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('tasks')
  return <CountBadge count={count} label={t('unseenBadge', { count })} className={className} />
}
