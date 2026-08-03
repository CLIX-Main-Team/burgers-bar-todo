import type { Task } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'

// Status reads through the soft status variants (issue #101, components.md): a not-started task is
// the neutral muted surface, an in-progress one warning, a done one success. The soft tints keep
// the small chip text above 4.5:1 in both themes. Rendered inline rather than through a Badge
// primitive, which is not yet built.
const statusChip: Record<Task['status'], string> = {
  not_started: 'bg-muted text-muted-foreground',
  in_progress: 'bg-warning-muted text-warning-muted-foreground',
  done: 'bg-success-muted text-success-muted-foreground',
}

// Priority ramps quiet→loud: low is neutral, normal a soft accent, high the soft destructive tint
// so the most urgent work carries the most colour without shouting.
const priorityChip: Record<Task['priority'], string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-accent text-accent-foreground',
  high: 'bg-destructive-muted text-destructive-muted-foreground',
}

const chipBase = 'inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium'

// One task on the board: every field the read carries renders here (story 9) — title, priority,
// status, description, assignees, due date, and, for a done task, the system-maintained completed
// time. A task with no assignees is the backlog (managers and admins only ever see it; the scope
// predicate keeps it off an employee's board entirely).
export function TaskCard({ task }: { task: Task }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {/* dir="auto" so an authored title lays out by its own characters — a Hebrew title reads
            RTL and an English one LTR regardless of the interface language. */}
        <h3 dir="auto" className="min-w-0 break-words font-semibold text-foreground">
          {task.title}
        </h3>
        <span className={cn(chipBase, 'shrink-0', priorityChip[task.priority])}>
          {t(taskPriorityLabelKey(task.priority))}
        </span>
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
    </article>
  )
}
