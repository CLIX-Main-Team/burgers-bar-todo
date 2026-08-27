import type { Task, TaskPriority } from '@burgers/shared'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT, STATUS_ORDER } from '../tasks/board-columns.js'
import { dueDay, isOverdue } from '../tasks/due-date.js'
import { FilterMenu } from '../tasks/filter-menu.js'
import { PRIORITY_INK, isRaised, priorityPill } from '../tasks/priority.js'
import { ANY_FILTER } from '../tasks/task-filters.js'
import type { SharedTask } from '../tasks/task-filters.js'
import { paginate } from './dashboard-metrics.js'

// The Home screen's task table (owner ask 2026-08-23: "active user task + done task that is
// paginated and filterable per branch").
//
// It is deliberately a READ. The board at /tasks is where work is written — status is changed,
// a task is opened, a row is dragged — and duplicating any of that here would mean two places
// to keep correct and two places to fix. So this table narrows, pages, and shows; the card head
// carries the one link out to the surface that writes.
//
// The three filters are the board's own FilterMenu chips, so a filter looks and behaves the
// same on both screens: a dashed outline is an empty slot, a solid one holds the chosen value
// and grows an × that clears it. Branch only appears where the viewer's board actually mixes
// branches — a one-branch manager filtering by their own branch is a control that can only ever
// do nothing.

// Rows per page. Eight is what fits under the cards above without the page growing a second
// scroll of its own, and it keeps the pager honest — a page size nobody ever reaches the end of
// is a pager nobody uses.
const PAGE_SIZE = 8

// One grid template shared by the head and every row, so the columns cannot drift apart. The
// task column takes the slack; the rest are sized to their longest realistic content.
const GRID = 'grid grid-cols-[minmax(0,1fr)_6.75rem_6.5rem_5.5rem_4.75rem] gap-0'

const PRIORITY_ORDER = ['high', 'medium', 'normal'] as const satisfies TaskPriority[]

export function DashboardTable({
  tasks,
  branches,
  now,
  enter,
  enterDelay,
}: {
  tasks: SharedTask[]
  /** Branch id → name. Empty for a viewer whose board never mixes branches. */
  branches: Map<string, string>
  now: Date
  /** The screen's entrance utility and this card's place in it. The table is the last thing to
   *  arrive and the only card here that outlives its own arrival — it stays mounted through
   *  every filter and page change, so the animation plays once and paging never replays it. */
  enter: string
  enterDelay: number
}) {
  const t = useTranslations()
  const [branchId, setBranchId] = useState<string>(ANY_FILTER)
  const [status, setStatus] = useState<string>(ANY_FILTER)
  const [priority, setPriority] = useState<string>(ANY_FILTER)
  const [page, setPage] = useState(1)

  // Every filter change returns to the first page. Without it, narrowing from a long list to a
  // short one leaves the reader on a page that no longer exists — paginate() would clamp them
  // to the last page, which reads as "the filter jumped me somewhere" rather than as a fresh
  // result. Rewritten as a setter wrapper rather than an effect: this is one state change, not
  // a synchronisation.
  const filter =
    <T,>(set: (next: T) => void) =>
    (next: T) => {
      set(next)
      setPage(1)
    }

  const filtered = useMemo(
    () =>
      tasks.filter((task) => {
        if (branchId !== ANY_FILTER && task.locationId !== branchId) return false
        if (status !== ANY_FILTER && task.status !== status) return false
        if (priority !== ANY_FILTER && task.priority !== priority) return false
        return true
      }),
    [tasks, branchId, status, priority],
  )

  const shown = paginate(filtered, page, PAGE_SIZE)
  const showBranchFilter = branches.size > 1

  return (
    <section
      className={cn('rounded-lg border border-border bg-card shadow-sm', enter)}
      style={{ animationDelay: `${enterDelay}ms` }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-[15px]">
        <h2 className="me-auto text-heading-sm font-bold text-foreground">
          {t('dashboard.tableTitle')}
        </h2>

        {showBranchFilter ? (
          <FilterMenu
            facet={t('tasks.facetBranch')}
            icon="location"
            value={branchId}
            onChange={filter(setBranchId)}
            anyLabel={t('tasks.filterAnyBranch')}
            clearLabel={t('tasks.clearFacet', { facet: t('tasks.facetBranch') })}
            choices={[...branches].map(([id, name]) => ({ value: id, label: name }))}
          />
        ) : null}

        <FilterMenu
          facet={t('dashboard.facetStatus')}
          icon="status-in-progress"
          value={status}
          onChange={filter(setStatus)}
          anyLabel={t('dashboard.filterAnyStatus')}
          clearLabel={t('tasks.clearFacet', { facet: t('dashboard.facetStatus') })}
          choices={STATUS_ORDER.map((each) => ({
            value: each,
            label: t(taskStatusLabelKey(each)),
            lead: (
              <span
                aria-hidden="true"
                className={cn('size-[7px] rounded-full', STATUS_DOT[each])}
              />
            ),
          }))}
        />

        <FilterMenu
          facet={t('dashboard.facetPriority')}
          icon="priority"
          value={priority}
          onChange={filter(setPriority)}
          anyLabel={t('dashboard.filterAnyPriority')}
          clearLabel={t('tasks.clearFacet', { facet: t('dashboard.facetPriority') })}
          choices={PRIORITY_ORDER.map((each) => ({
            value: each,
            label: t(taskPriorityLabelKey(each)),
            lead: (
              <Icon
                name="priority"
                size="sm"
                active={each === 'high'}
                className={cn('flex-none', PRIORITY_INK[each])}
              />
            ),
          }))}
        />
      </div>

      {/* The table is wider than a phone, so it scrolls inside its own rail rather than pushing
          the page sideways — the same rail the board's list view scrolls in. */}
      <div className="overflow-x-auto border-t border-border">
        <div className="min-w-[38rem]">
          <div
            aria-hidden="true"
            className={cn(
              GRID,
              'h-[30px] border-b border-border bg-lane px-4 text-caption font-semibold text-muted-foreground',
            )}
          >
            <span className="flex items-center pe-3">{t('tasks.colTask')}</span>
            <span className="flex items-center whitespace-nowrap px-3">{t('tasks.colStatus')}</span>
            <span className="flex items-center px-3">{t('tasks.colPriority')}</span>
            <span className="flex items-center px-3">{t('tasks.colAssignee')}</span>
            <span className="flex items-center px-3">{t('tasks.colDue')}</span>
          </div>

          {shown.rows.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-4 py-10 text-body text-muted-foreground">
              <Icon name="board-empty" size="sm" />
              {t('dashboard.tableEmpty')}
            </p>
          ) : (
            <ul>
              {shown.rows.map((task) => (
                <TableRow
                  key={task.id}
                  task={task}
                  branchName={branches.get(task.locationId)}
                  now={now}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* The pager is drawn even on a single page, holding the range line. It is the sentence
          that says how much there is — hiding it the moment a filter narrows to one page would
          take the count away exactly when the reader wants to check it. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5">
        <p className="me-auto text-caption tabular-nums text-muted-foreground">
          {t('dashboard.tableRange', { from: shown.from, to: shown.to, total: shown.total })}
        </p>
        <div className="flex items-center gap-1">
          <PagerButton
            icon="pager-prev"
            label={t('dashboard.prevPage')}
            disabled={shown.page <= 1}
            onClick={() => setPage(shown.page - 1)}
          />
          <span className="px-1 text-caption tabular-nums text-muted-foreground">
            {t('dashboard.pageOf', { page: shown.page, pages: shown.pageCount })}
          </span>
          <PagerButton
            icon="pager-next"
            label={t('dashboard.nextPage')}
            disabled={shown.page >= shown.pageCount}
            onClick={() => setPage(shown.page + 1)}
          />
        </div>
      </div>
    </section>
  )
}

function PagerButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: 'pager-prev' | 'pager-next'
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-grid size-8 place-items-center rounded-md border border-border-strong text-muted-foreground transition-colors hover:bg-lane hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
    >
      <Icon name={icon} size="sm" />
    </button>
  )
}

function TableRow({
  task,
  branchName,
  now,
}: {
  task: Task
  branchName?: string
  now: Date
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const overdue = isOverdue(task.dueDate, task.status, now)

  const dueLabel = (iso: string) => {
    const day = dueDay(iso, now)
    if (day === 'today') return t('tasks.dueToday')
    if (day === 'tomorrow') return t('tasks.dueTomorrow')
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))
  }

  return (
    <li
      className={cn(
        GRID,
        'min-h-11 items-stretch border-b border-border px-4 last:border-b-0 md:min-h-12',
        'hover:bg-lane',
      )}
    >
      {/* items-start so a Hebrew title hugs the row's start exactly as an English one does.
          dir="auto" makes each span itself RTL, and a stretched RTL block pushes its text to the
          far end of a column this wide — which left the English rows at one edge of the table and
          the Hebrew rows at the other. Shrink-wrapping the lines keeps the column's start edge
          straight in a mixed-script board without changing how the text lays out inside them. */}
      <div className="flex min-w-0 flex-col items-start justify-center gap-0.5 py-2 pe-3">
        <span dir="auto" className="max-w-full truncate text-body font-semibold text-foreground">
          {task.title}
        </span>
        {branchName ? (
          <span dir="auto" className="max-w-full truncate text-caption text-muted-foreground">
            {branchName}
          </span>
        ) : null}
      </div>

      {/* A dot beside the word, never the dot alone — the same pairing every status mark in this
          app makes, so colour is never the only carrier (WCAG 1.4.1). */}
      <div className="flex items-center px-3">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn('size-[7px] flex-none rounded-full', STATUS_DOT[task.status])}
          />
          {t(taskStatusLabelKey(task.status))}
        </span>
      </div>

      <div className="flex items-center px-3">
        {isRaised(task.priority) ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap text-caption font-semibold',
              priorityPill(task.priority),
            )}
          >
            <Icon name="priority" size="sm" active={task.priority === 'high'} />
            {t(taskPriorityLabelKey(task.priority))}
          </span>
        ) : (
          // Normal is the floor every task starts at and says nothing, the same rule the board's
          // list column follows: the cell only speaks when a priority was actually raised.
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>

      <div className="flex items-center px-3">
        {task.assignees.length > 0 ? (
          <AvatarStack
            names={task.assignees.map((assignee) => assignee.displayName)}
            label={t('tasks.assignedTo')}
          />
        ) : (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-muted-foreground">
            <Icon name="backlog" size="sm" />
            {t('tasks.backlog')}
          </span>
        )}
      </div>

      <div className="flex items-center px-3">
        {task.dueDate ? (
          <span
            className={cn(
              'whitespace-nowrap text-caption tabular-nums text-muted-foreground',
              overdue && 'font-semibold text-destructive',
            )}
          >
            {dueLabel(task.dueDate)}
          </span>
        ) : (
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>
    </li>
  )
}
