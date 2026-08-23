import type { Task, TaskStatus } from '@burgers/shared'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT, type StatusColumn } from './board-columns.js'
import { dueDay, isOverdue } from './due-date.js'
import { isRaised, priorityPill } from './priority.js'

// The list view (v2, handoff §4): the same board, laid out for scanning rather than working.
//
// It is deliberately NOT a second board. The status group heading wears the identical dot and
// label the kanban's lane head wears, and each row's status control is the same StatusControl
// pill the card carries — so switching views keeps the reader's anchors and the status write is
// one gesture in both places. What changes is density: five aligned columns instead of a stack,
// which is what makes a 40-task board readable at a glance.
//
// The whole row opens the task, not a chevron at its end: the row is the object. It is the
// title button that stretches over the row rather than a click handler on the row itself, so
// the pointer gets the whole surface and the keyboard gets one real, focusable control. The
// status chip lifts above that overlay, so setting a status never also opens the editor.

// One grid template shared by the head and every row, so the columns cannot drift apart. The
// task column takes the slack; the rest are sized to their longest realistic content.
const GRID = 'grid grid-cols-[minmax(0,1fr)_7.375rem_5.75rem_6rem_4.75rem] gap-0'

export function TaskList({
  columns,
  onOpen,
  onCreate,
  onStatusChange,
  canWrite,
  locationNames,
}: {
  columns: StatusColumn[]
  // Opening a task is the row's whole job, so the row is the target rather than a chevron at its
  // end — the same gesture the Locations table settled on in round 9.
  onOpen: (task: Task) => void
  // The per-group create row, offered only where the viewer may write.
  onCreate: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  // Branch names, supplied only on an admin's chain-wide board, where the rows mix branches.
  locationNames?: Map<string, string>
}) {
  // Which groups the reader has folded shut (owner ask 2026-08-21). A long board is usually
  // read one status at a time — what is left to do, or what is still running — and folding the
  // other two is how the list answers that without a filter that also changes what the counts
  // say. Held here rather than inside each group for the head below, and deliberately not
  // persisted: it is a reading position, not a setting, so the list opens whole every time.
  const [collapsed, setCollapsed] = useState<TaskStatus[]>([])
  const toggle = (status: TaskStatus) =>
    setCollapsed((shut) =>
      shut.includes(status) ? shut.filter((each) => each !== status) : [...shut, status],
    )

  // The column head is written once, over the first group that SHOWS rows — the columns are
  // identical in every group, so repeating the head under each status would be three copies of
  // the same sentence. Reading it once also makes the groups read as one table split by status,
  // which is what they are. It follows the fold: shut the top group and the head moves down to
  // the first group still open, so the columns are never named over nothing.
  const firstFilled = columns.find(
    (column) => column.tasks.length > 0 && !collapsed.includes(column.status),
  )?.status

  return (
    // The table is wider than a phone, so it scrolls inside its own rail rather than pushing the
    // page sideways. Below md the board view is the better phone surface anyway; this stays
    // reachable rather than pretending to reflow into something it is not.
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-[34rem]">
        {columns.map((column) => (
          <StatusGroup
            key={column.status}
            column={column}
            showHead={column.status === firstFilled}
            open={!collapsed.includes(column.status)}
            onToggle={() => toggle(column.status)}
            onOpen={onOpen}
            onCreate={onCreate}
            onStatusChange={onStatusChange}
            canWrite={canWrite}
            locationNames={locationNames}
          />
        ))}
      </div>
    </div>
  )
}

function StatusGroup({
  column,
  showHead,
  open,
  onToggle,
  onOpen,
  onCreate,
  onStatusChange,
  canWrite,
  locationNames,
}: {
  column: StatusColumn
  // True for the first group that shows rows: the column head is written once for the whole table.
  showHead: boolean
  // Whether this group's rows are showing. Its heading is always drawn, so a folded status still
  // reports its count — folding is meant to put a status out of the way, not out of mind.
  open: boolean
  onToggle: () => void
  onOpen: (task: Task) => void
  onCreate: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  locationNames?: Map<string, string>
}) {
  const t = useTranslations()
  // An empty status is left out entirely rather than shown as a heading over nothing: in a list
  // the reader is scanning content, and a heading with no rows under it is a false lead.
  if (column.tasks.length === 0) return null

  return (
    // A folded group closes up to a tighter gap: three of them should stack as a short index of
    // the board, not float 24px apart as if something were still between them.
    <section className={cn('last:mb-0', open ? 'mb-6' : 'mb-2')}>
      {/* The whole heading is the fold: the caret leads it, the way a disclosure triangle has
          always led the thing it opens, and the status chip and its count ride along as the
          button's own label — so the control names itself and needs no second word for it.
          The caret is the directional row-forward glyph when shut, which mirrors on its own
          in Hebrew, rather than a down-caret rotated by hand in one direction. */}
      <h2 className="flex py-[5px]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`task-group-${column.status}`}
          className="group inline-flex min-h-8 items-center gap-[9px] rounded-md pe-1.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <Icon
            name={open ? 'disclosure' : 'row-forward'}
            size="sm"
            className="flex-none text-muted-foreground group-hover:text-foreground"
          />
          <span className="inline-flex items-center gap-1.5 rounded-md bg-lane px-2.5 py-[3px] text-caption font-bold whitespace-nowrap text-foreground">
            <span
              aria-hidden="true"
              className={cn('size-[7px] rounded-full', STATUS_DOT[column.status])}
            />
            {t(taskStatusLabelKey(column.status))}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {column.tasks.length}
          </span>
        </button>
      </h2>

      {/* The head is presentational, not a <table>: the rows are buttons that open a task, and a
          real table row cannot hold an interactive row target without fighting its own semantics.
          The columns are named for assistive tech by each cell's own label instead. */}
      {showHead ? (
        <div
          aria-hidden="true"
          className={cn(
            GRID,
            'h-[30px] border-b border-border text-caption font-semibold text-muted-foreground',
          )}
        >
          <span className="flex items-center pe-3">{t('tasks.colTask')}</span>
          <span className="flex items-center whitespace-nowrap px-3">{t('tasks.colStatus')}</span>
          <span className="flex items-center px-3">{t('tasks.colAssignee')}</span>
          <span className="flex items-center px-3">{t('tasks.colDue')}</span>
          <span className="flex items-center px-3">{t('tasks.colPriority')}</span>
        </div>
      ) : (
        <div aria-hidden="true" className="border-b border-border" />
      )}

      <ul id={`task-group-${column.status}`} hidden={!open}>
        {column.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            canWrite={canWrite}
            locationName={locationNames?.get(task.locationId)}
          />
        ))}
      </ul>

      {/* The quiet create row under each group (handoff §4). It reads as a row rather than a
          button because that is where a new task lands: at the end of this status. */}
      {canWrite && open ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-11 w-full items-center gap-2 px-1 text-start text-caption text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Icon name="create" size="sm" />
          {t('tasks.create')}
        </button>
      ) : null}
    </section>
  )
}

function TaskRow({
  task,
  onOpen,
  onStatusChange,
  canWrite,
  locationName,
}: {
  task: Task
  onOpen: (task: Task) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  locationName?: string
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const now = new Date()
  const overdue = isOverdue(task.dueDate, task.status, now)

  const dueLabel = (iso: string) => {
    const day = dueDay(iso, now)
    if (day === 'today') return t('tasks.dueToday')
    if (day === 'tomorrow') return t('tasks.dueTomorrow')
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))
  }

  // The second line under the title: the branch on a chain-wide board, then the description, so a
  // row still says where it belongs without spending a column on it.
  const meta = [locationName, task.description].filter(Boolean).join(' · ')

  return (
    <li
      className={cn(
        GRID,
        'relative',
        // min-h-11 is the 44px touch floor; it relaxes to the artboard's 48px scanning rhythm from
        // md, where the pointer does not need it.
        'min-h-11 items-stretch border-b border-border last:border-b-0 md:min-h-12',
        'hover:bg-lane',
      )}
    >
      <div className="flex min-w-0 flex-col justify-center gap-0.5 py-2 pe-3">
        {/* The title IS the open control, and its ::after stretches over the whole row — so a
            click anywhere on the row opens the task while the keyboard still gets exactly one
            tab stop with a visible focus ring. It does not underline on hover (owner call
            2026-08-21): the row already lifts to the lane surface under the pointer, and an
            underline on top of that said "link" about something that opens in place. dir="auto" so an authored Hebrew title lays out
            by its own script inside an English UI and the reverse. */}
        <button
          type="button"
          dir="auto"
          onClick={() => onOpen(task)}
          className="min-w-0 truncate text-start text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {task.title}
        </button>
        {meta ? (
          <span dir="auto" className="truncate text-caption text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </div>

      {/* The status chip is a control of its own, so it lifts above the title's row-wide
          overlay: setting a status must never also open the editor behind it. */}
      <div className="relative z-10 flex items-center px-3">
        <span className="whitespace-nowrap">
          <StatusControl
            status={task.status}
            onSelect={(status) => onStatusChange(task.id, status)}
            label={t('tasks.changeStatus', { title: task.title })}
            disabled={!canWrite}
          />
        </span>
      </div>

      <div className="flex items-center px-3">
        {task.assignees.length > 0 ? (
          <AvatarStack
            names={task.assignees.map((assignee) => assignee.displayName)}
            label={t('tasks.assignedTo')}
          />
        ) : (
          // The backlog reads as its own quiet chip rather than an empty cell, because unassigned
          // is a state a manager acts on, not missing data.
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong px-2 py-0.5 text-caption text-muted-foreground">
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

      <div className="flex items-center px-3">
        {isRaised(task.priority) ? (
          // The same pill the card wears, so one word means one colour wherever it is read.
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
          // Normal is the implicit default and says nothing, the same rule the card follows: the
          // column only speaks when a priority was actually raised.
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>
    </li>
  )
}
