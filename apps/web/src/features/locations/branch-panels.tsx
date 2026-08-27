import type { Location, PrincipalResponse, Role, Task, UserSummary } from '@burgers/shared'
import { isSuperAdmin } from '@burgers/shared'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { dueDay, isOverdue } from '../tasks/due-date.js'
import { AssignDialogBody } from './assign-dialog.js'

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

// The staffing slots the roster list grew into (owner ask 2026-08-27): the same three ranks the
// branch box on the index prints — admin, manager, employees — each stating its people or its
// absence, and for a super_admin the absence is a control: an unassigned slot opens a chooser
// that moves someone here or invites someone new with the slot's role and branch pre-chosen.
// Everyone else reads the same rows inert, the page's usual presentation gating over an API that
// refuses the move for them anyway (ADR-0007).
const STAFFING_SLOTS: readonly Role[] = ['admin', 'manager', 'employee']

export function StaffingPanel({
  branch,
  people,
  principal,
}: { branch: Location; people: UserSummary[]; principal: PrincipalResponse }) {
  const t = useTranslations()
  const canStaff = isSuperAdmin(principal.role)
  // Which slot's chooser is open, or none. One state for the three slots: only one dialog
  // can be open at a time, and closing it always means the same thing.
  const [staffing, setStaffing] = useState<Role | null>(null)

  return (
    <Panel
      title={t('locations.rosterTitle')}
      count={people.length}
      to="/people"
      linkLabel={t('locations.rosterLink')}
    >
      <div className="flex flex-col gap-3">
        {STAFFING_SLOTS.map((role) => (
          <StaffingSlot
            key={role}
            role={role}
            people={people.filter((person) => person.role === role)}
            onAssign={canStaff ? () => setStaffing(role) : null}
          />
        ))}
      </div>

      <Dialog
        open={staffing !== null}
        onClose={() => setStaffing(null)}
        title={staffing ? t('locations.assignTitle', { role: t(roleLabelKey(staffing)) }) : ''}
      >
        {staffing ? (
          <AssignDialogBody
            branch={branch}
            role={staffing}
            principal={principal}
            onClose={() => setStaffing(null)}
          />
        ) : null}
      </Dialog>
    </Panel>
  )
}

// One rank of the branch: its label and count, then its people as the roster rows this panel
// always drew, or the slot's one honest absence — Unassigned — which for a staffing viewer is
// the button that fills it. The label row carries its own quiet add control too, so a slot
// that already has a manager can still take a second one.
function StaffingSlot({
  role,
  people,
  onAssign,
}: { role: Role; people: UserSummary[]; onAssign: (() => void) | null }) {
  const t = useTranslations()
  const assignLabel = t('locations.assignTitle', { role: t(roleLabelKey(role)) })

  return (
    <section>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <h3 className="text-label font-semibold text-muted-foreground">
            {role === 'employee' ? t('locations.slotEmployees') : t(roleLabelKey(role))}
          </h3>
          {people.length > 0 ? (
            <span className="text-caption tabular-nums text-muted-foreground">{people.length}</span>
          ) : null}
        </span>
        {onAssign && people.length > 0 ? (
          <button
            type="button"
            aria-label={assignLabel}
            onClick={onAssign}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="create" size="sm" />
          </button>
        ) : null}
      </div>
      {people.length === 0 ? (
        onAssign ? (
          // The absence as the affordance: the dashed row says what is missing and takes the
          // click that fixes it, which is the whole ask this panel was recut for.
          <button
            type="button"
            onClick={onAssign}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-dashed border-border-strong px-2.5 text-label text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="create" size="sm" />
            {t('locations.unassigned')}
          </button>
        ) : (
          <p className="flex min-h-11 items-center text-label text-muted-foreground/70">
            {t('locations.unassigned')}
          </p>
        )
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
            </li>
          ))}
        </ul>
      )}
    </section>
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
                    someone holds it, the backlog mark when nobody does. An empty assignee set is
                    not missing data on this panel — it is the answer to "what is nobody on yet",
                    which is most of why a branch admin opens this page at all. */}
                {task.assignees.length > 0 ? (
                  <AvatarStack
                    names={task.assignees.map((assignee) => assignee.displayName)}
                    label={t('tasks.assignedTo')}
                    className="flex-none"
                  />
                ) : (
                  // The mark keeps the row's width; the word arrives on hover, in the app's
                  // own tooltip — the bubble the AvatarStack hangs off a disc (avatar.tsx),
                  // not the browser's `title`, which waits about a second over a 16px target
                  // and so read as nothing happening at all. `group-active` comes with the
                  // pattern and is what carries it to the phone builds, where there is no
                  // hover: a press shows the same bubble.
                  <span className="group relative flex-none">
                    <Icon
                      name="backlog"
                      size="sm"
                      label={t('tasks.backlog')}
                      className="text-muted-foreground"
                    />
                    {/* Beside the mark, not above it. The avatar bubble sits above its disc
                        because it lives on a card that clips nothing; this panel's body is a
                        scroll container, so anything hanging above the first row would be cut
                        off by the very edge it needs to cross. Alongside and vertically
                        centred, it grows back into the row's own empty middle and is never
                        clipped, on any row. */}
                    <span
                      dir="auto"
                      className="pointer-events-none absolute end-full top-1/2 z-10 me-1.5 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-caption font-semibold text-background shadow-sm group-hover:block group-active:block"
                    >
                      {t('tasks.backlog')}
                    </span>
                  </span>
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
