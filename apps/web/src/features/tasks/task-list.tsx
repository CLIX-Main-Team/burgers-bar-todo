import type { Task, TaskStatus } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT, type StatusColumn } from './board-columns.js'

// The list view (v2, 2026-08-20): the same board, laid out for scanning rather than working.
//
// It is deliberately NOT a second board. The status group heading wears the identical dot and
// label the kanban's lane head wears, and each row's status control is the same StatusControl
// pill the card carries — so switching views keeps the reader's anchors and the status write is
// one gesture in both places. What changes is density: five aligned columns instead of a stack,
// which is what makes a 40-task board readable at a glance.
//
// Dropped from the v2 artboard on purpose: its per-group "+ New task" ghost row. It put the
// primary action on the screen three times over; the header's own button is enough.

const PRIORITY_DOT: Record<Task['priority'], string> = {
  high: 'bg-status-not-started-dot',
  normal: 'bg-border-strong',
  low: 'bg-border-strong',
}

// One grid template shared by the head and every row, so the columns cannot drift apart. The
// task column takes the slack; the rest are sized to their longest realistic content.
const GRID = 'grid grid-cols-[minmax(0,1fr)_7.375rem_5.75rem_6rem_4.75rem] gap-0'

export function TaskList({
  columns,
  onOpen,
  onStatusChange,
  canWrite,
  locationNames,
}: {
  columns: StatusColumn[]
  // Opening a task is the row's whole job, so the row is the target rather than a chevron at its
  // end — the same gesture the Locations table settled on in round 9.
  onOpen: (task: Task) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  // Branch names, supplied only on an admin's chain-wide board, where the rows mix branches.
  locationNames?: Map<string, string>
}) {
  // The column head is written once, over the first group that has rows — the columns are
  // identical in every group, so repeating the head under each status would be three copies of
  // the same sentence. Reading it once also makes the groups read as one table split by status,
  // which is what they are.
  const firstFilled = columns.find((column) => column.tasks.length > 0)?.status

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
            onOpen={onOpen}
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
  onOpen,
  onStatusChange,
  canWrite,
  locationNames,
}: {
  column: StatusColumn
  // True for the first group that has rows: the column head is written once for the whole table.
  showHead: boolean
  onOpen: (task: Task) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  locationNames?: Map<string, string>
}) {
  const t = useTranslations()
  // An empty status is left out entirely rather than shown as a heading over nothing: in a list
  // the reader is scanning content, and a heading with no rows under it is a false lead.
  if (column.tasks.length === 0) return null

  return (
    <section className="mb-6 last:mb-0">
      <div className="flex items-center gap-[9px] py-[5px]">
        <h2 className="inline-flex items-center gap-1.5 rounded-md bg-lane px-2.5 py-[3px] text-caption font-bold whitespace-nowrap text-foreground">
          <span
            aria-hidden="true"
            className={cn('size-[7px] rounded-full', STATUS_DOT[column.status])}
          />
          {t(taskStatusLabelKey(column.status))}
        </h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {column.tasks.length}
        </span>
      </div>

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

      <ul>
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
  const isDone = task.status === 'done'
  // Overdue is a live comparison and never applies to a finished task, exactly as on the card.
  const isOverdue =
    !isDone && task.dueDate !== null && new Date(task.dueDate).getTime() < Date.now()
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))

  // The second line under the title: the branch on a chain-wide board, then the description, so a
  // row still says where it belongs without spending a column on it.
  const meta = [locationName, task.description].filter(Boolean).join(' · ')

  return (
    <li
      className={cn(
        GRID,
        // min-h-11 is the 44px touch floor; it relaxes to the artboard's 48px scanning rhythm from
        // md, where the pointer does not need it.
        'min-h-11 items-stretch border-b border-border last:border-b-0 md:min-h-12',
        'hover:bg-lane',
      )}
    >
      <div className="flex min-w-0 flex-col justify-center gap-0.5 py-2 pe-3">
        {/* The title IS the open control. dir="auto" so an authored Hebrew title lays out by its
            own script inside an English UI and the reverse. */}
        <button
          type="button"
          dir="auto"
          onClick={() => onOpen(task)}
          className="min-w-0 truncate text-start text-body font-semibold text-foreground hover:underline"
        >
          {task.title}
        </button>
        {meta ? (
          <span dir="auto" className="truncate text-caption text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </div>

      <div className="flex items-center px-3">
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
              isOverdue && 'font-semibold text-destructive-muted-foreground',
            )}
          >
            {formatDate(task.dueDate)}
          </span>
        ) : (
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>

      <div className="flex items-center px-3">
        {task.priority === 'normal' ? (
          // Normal is the implicit default and says nothing, the same rule the card follows: the
          // column only speaks when a priority was actually set.
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-caption font-medium text-foreground">
            <span
              aria-hidden="true"
              className={cn('size-[7px] flex-none rounded-full', PRIORITY_DOT[task.priority])}
            />
            {t(taskPriorityLabelKey(task.priority))}
          </span>
        )}
      </div>
    </li>
  )
}
