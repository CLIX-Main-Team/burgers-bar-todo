import type { Task } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'

// Status reads the gold-and-neutral family (issue #101, components.md §Badge): a not-started task is
// the neutral muted surface, an in-progress one the warm gold accent (active without spending the
// scarce gold primary fill), a done one the earthy olive success tint. The soft tints keep the small
// chip text above 4.5:1 in both themes. Rendered inline rather than through a Badge primitive, which
// is not yet built.
const statusChip: Record<Task['status'], string> = {
  not_started: 'bg-muted text-muted-foreground',
  in_progress: 'bg-accent text-accent-foreground',
  done: 'bg-success-muted text-success-muted-foreground',
}

// Priority is the orange family (components.md §Badge), held apart from the gold-and-neutral status
// family so a priority chip and a status chip never read as the same signal on one card: low is the
// neutral muted surface, high the warning-soft burnt orange. Normal renders no chip at all — the
// implicit default is omitted to cut board noise, so this map carries only the two that show.
const priorityChip: Partial<Record<Task['priority'], string>> = {
  low: 'bg-muted text-muted-foreground',
  high: 'bg-warning-muted text-warning-muted-foreground',
}

const chipBase = 'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium'

// One task on the board: every field the read carries renders here (story 9) — title, priority,
// status, description, assignees, due date, and, for a done task, the system-maintained completed
// time. A task with no assignees is the backlog (managers and admins only ever see it; the scope
// predicate keeps it off an employee's board entirely). An optional `footer` carries the
// manager/admin write controls (#133) beneath the card; an employee's board passes none, so their
// card is display-only.
export function TaskCard({ task, footer }: { task: Task; footer?: React.ReactNode }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  const isHigh = task.priority === 'high'

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {/* dir="auto" so an authored title lays out by its own characters — a Hebrew title reads
            RTL and an English one LTR regardless of the interface language. */}
        <h3 dir="auto" className="min-w-0 break-words font-semibold text-foreground">
          {task.title}
        </h3>
        {/* Normal renders no chip (the implicit default). High leads with the `warning` glyph so the
            most urgent cards stand out at a scan (#161); the glyph is decorative — the chip's own
            label already names the priority — and takes the chip's warning-soft colour by the
            no-colour-prop rule (iconography.md). Low stays text-only. */}
        {task.priority !== 'normal' ? (
          <span
            className={cn(chipBase, 'shrink-0', isHigh && 'gap-1', priorityChip[task.priority])}
          >
            {isHigh ? <Icon name="priority-high" size="sm" /> : null}
            {t(taskPriorityLabelKey(task.priority))}
          </span>
        ) : null}
      </div>

      {task.description ? (
        // Shown in the language it was authored in and never translated (story 10); dir="auto"
        // gives the note its own reading direction.
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {task.description}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className={cn(chipBase, statusChip[task.status])}>
          {t(taskStatusLabelKey(task.status))}
        </span>
        {task.dueDate ? <span>{t('tasks.due', { date: formatDate(task.dueDate) })}</span> : null}
        {task.completedAt ? (
          <span>{t('tasks.completed', { date: formatDate(task.completedAt) })}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {task.assignees.length === 0 ? (
          <span className={cn(chipBase, 'bg-warning-muted text-warning-muted-foreground')}>
            {t('tasks.backlog')}
          </span>
        ) : (
          <>
            <span className="text-muted-foreground">{t('tasks.assignedTo')}</span>
            {task.assignees.map((assignee) => (
              <span
                key={assignee.id}
                dir="auto"
                className={cn(chipBase, 'bg-secondary text-secondary-foreground')}
              >
                {assignee.displayName}
              </span>
            ))}
          </>
        )}
      </div>

      {footer ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">{footer}</div>
      ) : null}
    </article>
  )
}
