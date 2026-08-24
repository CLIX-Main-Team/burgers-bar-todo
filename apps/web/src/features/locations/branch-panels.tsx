import type { Task, UserSummary } from '@burgers/shared'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { dueDay, isOverdue } from '../tasks/due-date.js'

// The two panels under the branch's KPI row: who works here, and what is still open. Neither
// reimplements the screen that owns its subject — the roster belongs to People and the work
// belongs to the board — so each shows its rows and then hands the reader over, which is what
// holds the decision that leadership stays owned by People rather than being edited from here.
//
// Both bodies are the same fixed height and scroll inside it (owner ask 2026-08-23). They used
// to show the first six rows and silently drop the rest, which had two faults: the two columns
// ended at different heights whenever the branch had more people than open work, and a row that
// fell past the cut was gone with nothing saying so. A fixed body fixes the ragged edge, and
// scrolling means nothing is hidden — the count in each heading is now the true total, not the
// number of rows that happened to fit.
//
// Six rows at the 44px touch floor, which is what the panels showed before, so the page keeps
// the height it was designed at.
const PANEL_BODY = 'h-[16.5rem] overflow-y-auto overscroll-contain'

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
          {people.map((person) => (
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
          {ranked.map((task) => {
            const overdue = isOverdue(task.dueDate, task.status, now)
            return (
              <li
                key={task.id}
                className="flex min-h-11 items-center gap-2.5 border-b border-border py-1.5 last:border-b-0"
              >
                <span dir="auto" className="min-w-0 flex-1 truncate text-body text-foreground">
                  {task.title}
                </span>
                {/* Who is on it, in the task card's own grammar (task-card.tsx): the stack when
                    someone holds it, the backlog chip when nobody does. An empty assignee set is
                    not missing data on this panel — it is the answer to "what is nobody on yet",
                    which is most of why a branch admin opens this page at all. */}
                {task.assignees.length > 0 ? (
                  <AvatarStack
                    names={task.assignees.map((assignee) => assignee.displayName)}
                    label={t('tasks.assignedTo')}
                    className="flex-none"
                  />
                ) : (
                  // The word, not a bare glyph. This started as an icon with a `title`, which
                  // is the wrong instrument twice over: a native tooltip waits about a second
                  // over a 16px target, and on the phone builds there is no hover at all, so
                  // the one state the reader most needs to recognise was the one state that
                  // explained itself least. It is the board's own backlog chip (task-card.tsx),
                  // so the two surfaces name an unheld task the same way.
                  <Badge variant="muted" className="flex-none">
                    <Icon name="backlog" size="sm" />
                    {t('tasks.backlog')}
                  </Badge>
                )}
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
      {/* pe-1 keeps the rows' bottom rule off the scrollbar gutter, on whichever side the
          reading direction puts it. */}
      <div className={cn('mt-2 pe-1', PANEL_BODY)}>{children}</div>
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
