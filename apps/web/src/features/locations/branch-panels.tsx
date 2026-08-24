import type { Task, UserSummary } from '@burgers/shared'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Avatar } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { dueDay, isOverdue } from '../tasks/due-date.js'

// The two panels under the branch's KPI row: who works here, and what is still open. Both
// are deliberately short. Neither reimplements the screen that owns its subject — the roster
// belongs to People and the work belongs to the board — so each shows the first few rows and
// then hands the reader over, which is what holds the decision that leadership stays owned by
// People rather than being edited from here.
const PANEL_ROWS = 6

export function RosterPanel({ people }: { people: UserSummary[] }) {
  const t = useTranslations()
  return (
    <Panel
      title={t('locations.rosterTitle')}
      count={people.length}
      to="/people"
      linkLabel={t('locations.rosterLink')}
    >
      {people.length === 0 ? (
        <PanelEmpty>{t('locations.rosterEmpty')}</PanelEmpty>
      ) : (
        <ul className="flex flex-col">
          {people.slice(0, PANEL_ROWS).map((person) => (
            <li
              key={person.id}
              className="flex min-h-11 items-center gap-2.5 border-b border-border py-1.5 last:border-b-0"
            >
              <Avatar name={person.displayName} className="size-7 flex-none" />
              <span dir="auto" className="min-w-0 flex-1 truncate text-body text-foreground">
                {person.displayName}
              </span>
              {/* The role reads through the shared label map, never as the raw enum slug. */}
              <span className="flex-none text-caption text-muted-foreground">
                {t(roleLabelKey(person.role))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function OpenWorkPanel({ tasks }: { tasks: Task[] }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const now = new Date()

  // Board order is position order, which is the order a shift runs in — but this panel only
  // has room for a handful of rows, so the ones with a deadline come first and the soonest
  // deadline comes first among those. What is cut off is what nobody is waiting on.
  const ranked = [...tasks].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || a.position - b.position
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.position - b.position
  })

  const dueLabel = (iso: string) => {
    const day = dueDay(iso, now)
    if (day === 'today') return t('tasks.dueToday')
    if (day === 'tomorrow') return t('tasks.dueTomorrow')
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))
  }

  return (
    <Panel
      title={t('locations.openWorkTitle')}
      count={tasks.length}
      to="/tasks"
      linkLabel={t('locations.openWorkLink')}
    >
      {ranked.length === 0 ? (
        <PanelEmpty>{t('locations.openWorkEmpty')}</PanelEmpty>
      ) : (
        <ul className="flex flex-col">
          {ranked.slice(0, PANEL_ROWS).map((task) => {
            const overdue = isOverdue(task.dueDate, task.status, now)
            return (
              <li
                key={task.id}
                className="flex min-h-11 items-center gap-2.5 border-b border-border py-1.5 last:border-b-0"
              >
                <span dir="auto" className="min-w-0 flex-1 truncate text-body text-foreground">
                  {task.title}
                </span>
                {task.dueDate ? (
                  <span
                    className={cn(
                      'flex flex-none items-center gap-1 whitespace-nowrap text-caption tabular-nums text-muted-foreground',
                      // The board's own overdue grammar: the date itself takes the ink, and
                      // the clock carries the word so the alarm is never colour alone.
                      overdue && 'font-semibold text-destructive',
                    )}
                  >
                    {overdue ? (
                      <Icon name="overdue" size="sm" label={t('locations.statOverdue')} />
                    ) : null}
                    {dueLabel(task.dueDate)}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// The shared shell: a heading with its count, the rows, and the way out to the screen that
// owns the whole set.
function Panel({
  title,
  count,
  to,
  linkLabel,
  children,
}: {
  title: string
  count: number
  to: string
  linkLabel: string
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card px-4 py-[15px] shadow-sm">
      <div className="flex items-baseline gap-2">
        <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
        <span className="text-caption tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div className="mt-2 flex-1">{children}</div>
      <Link
        to={to}
        className="mt-3 inline-flex min-h-11 items-center gap-1 self-start text-label font-semibold text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
      >
        {linkLabel}
        <Icon name="row-forward" size="sm" />
      </Link>
    </section>
  )
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="py-1.5 text-body text-muted-foreground">{children}</p>
}
