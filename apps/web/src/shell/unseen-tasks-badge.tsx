import { useTranslations } from 'use-intl'
import { Badge } from '../components/ui/badge.js'
import { cn } from '../lib/cn.js'

// The new-assignments count pill on the Tasks destination (#136), shared by the mobile tab bar and
// the desktop side nav so the two shells can never disagree on what the count looks like or says.
// It paints the soft warning family — the same "needs your attention" signal a high-priority chip
// carries, distinct from the accent the active destination uses. The visible number is aria-hidden
// and a sr-only sentence carries the meaning, so assistive tech hears "3 new assignments", never a
// bare digit. The caller decides when it shows (count > 0, destination not active) and where it
// sits — the tab bar floats it off the icon corner, the side nav seats it at the row's inline end.
export function UnseenTasksBadge({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('tasks')
  return (
    <Badge
      variant="warning"
      className={cn('min-w-5 justify-center px-1.5 py-0 text-xs font-semibold', className)}
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{t('unseenBadge', { count })}</span>
    </Badge>
  )
}
