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
// It is deliberately NOT a second board. Each row's status control is the same StatusControl pill
// the card carries — so switching views keeps the reader's anchors and the status write is one
// gesture in both places. What changes is density: aligned columns instead of a stack, which is
// what makes a 40-task board readable at a glance.
//
// The whole row opens the task, not a chevron at its end: the row is the object. It is the title
// button that stretches over the row rather than a click handler on the row itself, so the pointer
// gets the whole surface and the keyboard gets one real, focusable control. The status chip lifts
// above that overlay, so setting a status never also opens the editor.
//
// The frame (owner ask 2026-08-23, after Monday's tables): the groups sit inside ONE bordered
// surface with a single column head at its top, so three statuses read as one table split by
// status rather than three loose stacks on the page. The group's colour runs down the inline-start
// edge of its heading and every row under it — the one place colour is spent here, and it says
// which status a row belongs to even when the reader has scrolled past the heading.
//
// The frame is deliberately NOT `overflow-hidden`: the status pill's menu is absolutely positioned
// inside the row (it does not portal), so clipping the frame would clip an open menu.

// One grid template shared by the head and every row, so the columns cannot drift apart.
//
// Two shapes, and the reason there are two: the five-column table needs ~24rem of fixed columns,
// which leaves a phone (and a tablet beside the 240px rail) nothing for the title — that is what
// made this list scroll sideways (owner call 2026-08-23: the priority column pushed it over). So
// below `lg` the row keeps only what it cannot fold — the stripe, the task, and the one control
// that writes — and assignee, due date and priority ride the title's second line instead. Nothing
// is dropped, and no width scrolls.
//
// The fixed widths are sized to their longest realistic content rather than their usual content:
// the assignee column holds two avatars most of the time, but it has to hold the Backlog chip
// without leaning into the due date beside it.
const GRID = [
  'grid items-stretch',
  'grid-cols-[3px_minmax(0,1fr)_7rem]',
  'lg:grid-cols-[3px_minmax(0,1fr)_7rem_7rem_6rem_6rem]',
].join(' ')

// The columns that fold into the meta line below `lg`.
const WIDE_ONLY = 'hidden lg:flex'

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
  const t = useTranslations()

  // Which groups the reader has folded shut (owner ask 2026-08-21). A long board is usually read
  // one status at a time — what is left to do, or what is still running — and folding the other
  // two is how the list answers that without a filter that also changes what the counts say. Held
  // here rather than inside each group so the whole table shares one reading position, and
  // deliberately not persisted: it is a position, not a setting, so the list opens whole.
  const [collapsed, setCollapsed] = useState<TaskStatus[]>([])
  const toggle = (status: TaskStatus) =>
    setCollapsed((shut) =>
      shut.includes(status) ? shut.filter((each) => each !== status) : [...shut, status],
    )

  // An empty status is left out entirely rather than shown as a heading over nothing: in a list
  // the reader is scanning content, and a heading with no rows under it is a false lead.
  const groups = columns.filter((column) => column.tasks.length > 0)
  if (groups.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* The head is presentational, not a <table>: the rows are buttons that open a task, and a
          real table row cannot hold an interactive row target without fighting its own semantics.
          The columns are named for assistive tech by each cell's own label instead.

          It is written ONCE, at the top of the frame, because these are the columns of one table —
          repeating it under each status would be three copies of the same sentence. */}
      <div
        aria-hidden="true"
        className={cn(
          GRID,
          'h-8 rounded-t-lg border-b border-border bg-lane text-caption font-semibold text-muted-foreground',
        )}
      >
        <span />
        <span className="flex items-center px-3">{t('tasks.colTask')}</span>
        <span className="flex items-center whitespace-nowrap px-2 lg:px-3">
          {t('tasks.colStatus')}
        </span>
        <span className={cn(WIDE_ONLY, 'items-center px-3')}>{t('tasks.colAssignee')}</span>
        <span className={cn(WIDE_ONLY, 'items-center px-3')}>{t('tasks.colDue')}</span>
        <span className={cn(WIDE_ONLY, 'items-center px-3')}>{t('tasks.colPriority')}</span>
      </div>

      {groups.map((column, index) => (
        <StatusGroup
          key={column.status}
          column={column}
          open={!collapsed.includes(column.status)}
          onToggle={() => toggle(column.status)}
          onOpen={onOpen}
          onCreate={onCreate}
          onStatusChange={onStatusChange}
          canWrite={canWrite}
          locationNames={locationNames}
          // The frame draws the closing line itself, so the last group inside it does not.
          last={index === groups.length - 1}
        />
      ))}
    </div>
  )
}

function StatusGroup({
  column,
  open,
  onToggle,
  onOpen,
  onCreate,
  onStatusChange,
  canWrite,
  locationNames,
  last,
}: {
  column: StatusColumn
  // Whether this group's rows are showing. Its heading is always drawn, so a folded status still
  // reports its count — folding is meant to put a status out of the way, not out of mind.
  open: boolean
  onToggle: () => void
  onOpen: (task: Task) => void
  onCreate: () => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  canWrite: boolean
  locationNames?: Map<string, string>
  last: boolean
}) {
  const t = useTranslations()
  const stripe = STATUS_DOT[column.status]

  // Which of this group's parts closes the frame, in the last group only: the create row where
  // one is offered, else the last task row, else this heading when the group is folded shut.
  // Whichever it is drops its own bottom rule — the frame draws that line — and rounds the stripe
  // into the frame's corner so the colour does not run past the curve.
  const closer = !last ? 'none' : canWrite && open ? 'create' : open ? 'rows' : 'heading'

  return (
    <section>
      {/* The whole heading is the fold: the caret leads it, the way a disclosure triangle has
          always led the thing it opens, and the status name and its count ride along as the
          button's own label — so the control names itself and needs no second word for it. The
          caret is the directional row-forward glyph when shut, which mirrors on its own in
          Hebrew, rather than a down-caret rotated by hand in one direction.

          The dot the kanban's lane head wears is gone from the chip here: the stripe beside it is
          already this status's colour, and two marks for one fact is one too many. */}
      <h2
        className={cn(
          'flex items-stretch bg-lane',
          closer === 'heading' ? 'rounded-b-lg' : 'border-b border-border',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('w-[3px] flex-none', stripe, closer === 'heading' && 'rounded-es-lg')}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`task-group-${column.status}`}
          className="group inline-flex min-h-9 flex-1 items-center gap-2 px-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Icon
            name={open ? 'disclosure' : 'row-forward'}
            size="sm"
            className="flex-none text-muted-foreground group-hover:text-foreground"
          />
          <span className="text-caption font-bold whitespace-nowrap text-foreground">
            {t(taskStatusLabelKey(column.status))}
          </span>
          <span className="text-caption tabular-nums text-muted-foreground">
            {column.tasks.length}
          </span>
        </button>
      </h2>

      <ul
        id={`task-group-${column.status}`}
        hidden={!open}
        className={cn(closer === 'rows' && '[&>li:last-child>span:first-child]:rounded-es-lg')}
      >
        {column.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            stripe={stripe}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
            canWrite={canWrite}
            locationName={locationNames?.get(task.locationId)}
          />
        ))}
      </ul>

      {/* The quiet create row under each group (handoff §4). It reads as a row rather than a
          button because that is where a new task lands: at the end of this status. It carries no
          stripe — it is an action, not a task with a status — which also leaves the frame's last
          corner to the frame. */}
      {canWrite && open ? (
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            'flex min-h-11 w-full items-center gap-2 px-3 text-start text-caption text-muted-foreground hover:bg-lane hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            closer === 'create' ? 'rounded-b-lg' : 'border-b border-border',
          )}
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
  stripe,
  onOpen,
  onStatusChange,
  canWrite,
  locationName,
}: {
  task: Task
  // The group's colour, run down the row's inline-start edge.
  stripe: string
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

  const due = task.dueDate ? (
    <span
      className={cn(
        'whitespace-nowrap text-caption tabular-nums text-muted-foreground',
        overdue && 'font-semibold text-destructive',
      )}
    >
      {dueLabel(task.dueDate)}
    </span>
  ) : null

  const assignees =
    task.assignees.length > 0 ? (
      <AvatarStack
        names={task.assignees.map((assignee) => assignee.displayName)}
        label={t('tasks.assignedTo')}
      />
    ) : (
      // The backlog reads as its own quiet chip rather than an empty cell, because unassigned is a
      // state a manager acts on, not missing data.
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border-strong px-2 py-0.5 text-caption text-muted-foreground">
        <Icon name="backlog" size="sm" />
        {t('tasks.backlog')}
      </span>
    )

  const priority = isRaised(task.priority) ? (
    // The same pill the card wears, so one word means one colour wherever it is read. Normal is
    // the implicit default and says nothing, the same rule the card follows: the column only
    // speaks when a priority was actually raised.
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-semibold',
        priorityPill(task.priority),
      )}
    >
      <Icon name="priority" size="sm" active={task.priority === 'high'} />
      {t(taskPriorityLabelKey(task.priority))}
    </span>
  ) : null

  // The row's second line: on a narrow measure it carries the three columns that folded away, then
  // the branch (chain-wide boards) and the description. The chips never shrink and the text
  // truncates, so the line degrades in the one direction that keeps it readable.
  const text = [locationName, task.description].filter(Boolean).join(' · ')

  return (
    <li
      className={cn(
        GRID,
        'relative',
        // min-h-11 is the 44px touch floor; it relaxes to the artboard's 48px scanning rhythm from
        // md, where the pointer does not need it.
        'min-h-11 border-b border-border last:border-b-0 md:min-h-12',
        'hover:bg-lane',
      )}
    >
      <span aria-hidden="true" className={cn('block', stripe)} />

      <div className="flex min-w-0 flex-col justify-center gap-0.5 py-2 px-3">
        {/* The title IS the open control, and its ::after stretches over the whole row — so a
            click anywhere on the row opens the task while the keyboard still gets exactly one tab
            stop with a visible focus ring. It does not underline on hover (owner call
            2026-08-21): the row already lifts to the lane surface under the pointer, and an
            underline on top of that said "link" about something that opens in place. dir="auto"
            so an authored Hebrew title lays out by its own script inside an English UI. */}
        <button
          type="button"
          dir="auto"
          onClick={() => onOpen(task)}
          className="min-w-0 truncate text-start text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {task.title}
        </button>

        {/* It wraps rather than shrinks: the chips carry whole words and a squashed one is worse
            than a second line, and without the wrap a narrow row pushed them out over the status
            column beside it. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex-none lg:hidden">{assignees}</span>
          {due ? <span className="flex-none lg:hidden">{due}</span> : null}
          {priority ? <span className="flex-none lg:hidden">{priority}</span> : null}
          {text ? (
            <span dir="auto" className="min-w-0 truncate text-caption text-muted-foreground">
              {text}
            </span>
          ) : null}
        </div>
      </div>

      {/* The status chip is a control of its own, so it lifts above the title's row-wide overlay:
          setting a status must never also open the editor behind it. */}
      <div className="relative z-10 flex items-center px-2 lg:px-3">
        <span className="whitespace-nowrap">
          <StatusControl
            status={task.status}
            onSelect={(status) => onStatusChange(task.id, status)}
            label={t('tasks.changeStatus', { title: task.title })}
            disabled={!canWrite}
          />
        </span>
      </div>

      <div className={cn(WIDE_ONLY, 'items-center px-3')}>{assignees}</div>

      <div className={cn(WIDE_ONLY, 'items-center px-3')}>
        {due ?? (
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>

      <div className={cn(WIDE_ONLY, 'items-center px-3')}>
        {priority ?? (
          <span aria-hidden="true" className="text-caption text-border-strong">
            —
          </span>
        )}
      </div>
    </li>
  )
}
