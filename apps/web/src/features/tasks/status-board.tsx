import type { Task, TaskStatus } from '@burgers/shared'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type CSSProperties, type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { STATUS_DOT, type StatusColumn, resolveDrop } from './board-columns.js'
import { BOARD_PAGE_SIZE, ColumnPager } from './column-pager.js'

// The status kanban that reshapes the board body (#214, task-board mockup §Board body / §Column).
// At `lg` the three lanes are a `repeat(3,1fr)` grid, top-aligned. Below `lg` the board is one
// lane at a time behind a row of status pill tabs (owner decision 2026-08, recut 2026-08-12): the
// tabs carry each lane's name and count, and the list below shows only the active lane's cards.
// The lane trays are back on the desktop frame (v2 handoff §4): each lane sits in the --bb-lane
// tint at radius-lg with 10px of padding, which is what makes three columns read as three
// places. The 2026-08-12 call that removed them is superseded by this round. Cards carry their own
// border and shadow, so they sit directly on the page, the minimal look current task boards
// (Linear-style) draw. The same layout renders for every viewer — an employee, a writer with the
// priority lens on, a writer dragging — only the card (managed vs status) and whether drag is
// offered differ.
//
// Drag is reinterpreted here (the behaviour change the mockup fixed): a cross-lane drop is a
// *status change* (the target lane's status), a within-lane drop is a *reorder* (the shared
// `position`). The screen owns both writes; this only resolves a drop to one or the other and calls
// up. The priority lens disables drag entirely (`drag='off'`), scoped now per-column.
//
// Drag comes in two live modes because the two drop meanings map to different permissions: 'full'
// (manager/admin — both writes) and 'status-only' (employee — dragging between lanes IS their one
// permitted write, the same status change their card's pill makes, while a within-lane drop is a
// reorder they may not write and resolves to nothing). The API authorises every write regardless.
// The single-lane mobile view has no other lane to drop onto, so there a status change goes through
// the card's StatusControl pill (now on every card, not only an employee's): 'full' keeps its
// within-lane reorder drag, while 'status-only' — whose one gesture needs a second lane — offers no
// drag at all and the pill carries the write alone.

export type BoardDragMode = 'off' | 'full' | 'status-only'

// The desktop frame: a three-lane grid at `lg` (`space-lg` gap, top-aligned so a tall lane never
// stretches its neighbours). The frame is width-agnostic — the shell's content-inner already caps
// and centres it; below `lg` the board renders the tabbed single lane instead of this grid.
function BoardGrid({ children }: { children: ReactNode }) {
  return (
    // The lanes arrive as one movement and the cards stagger inside them; see .bb-stagger in
    // index.css and the SCORE in tasks-screen.tsx for where these two numbers come from.
    <div
      className="bb-stagger grid grid-cols-3 items-start gap-4.5"
      style={{ '--bb-stagger-base': '140ms' } as CSSProperties}
    >
      {children}
    </div>
  )
}

// The mobile status tabs, recut to The Counter's underline tabs (round 8, 2026-08-14 —
// superseding the round-6 white chips): plain text tabs on one shared baseline rule, each
// carrying its status dot, name, and count; the selected tab reads in full ink and hangs a
// 2px gold underline sitting on the rule. No chip surfaces at all — the row is the quietest
// piece of chrome on the screen, the same grammar the desktop lane heads draw.
function StatusTabs({
  columns,
  active,
  onSelect,
}: {
  columns: StatusColumn[]
  active: TaskStatus
  onSelect: (status: TaskStatus) => void
}) {
  const t = useTranslations()
  return (
    <fieldset
      aria-label={t('tasks.statusTabs')}
      className="m-0 flex gap-[22px] border-b border-border p-0"
    >
      {columns.map((column) => {
        const selected = column.status === active
        return (
          <button
            key={column.status}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(column.status)}
            className={cn(
              // Caption scale + nowrap so all three labels hold one line on a 390px phone;
              // min-h keeps the touch floor even though the visible tab is text-height.
              'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap px-0.5 pb-2.5 text-label font-semibold',
              // The phone board's primary navigation had no focus state at all (a11y audit
              // 2026-08-16); the ring is inset so it reads inside the tab's own text box.
              'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              selected ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {/* The lane's dot — decorative: the label names the lane. It keeps the status
                colour whether or not the tab is selected (the underline is the selection). */}
            <span
              aria-hidden="true"
              className={cn('size-[7px] shrink-0 rounded-full', STATUS_DOT[column.status])}
            />
            <span>{t(taskStatusLabelKey(column.status))}</span>
            <span className="font-medium tabular-nums text-muted-foreground">
              {column.tasks.length}
            </span>
            {/* The selected mark: a gold underline seated on the row's baseline rule. */}
            {selected ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-gold"
              />
            ) : null}
          </button>
        )
      })}
    </fieldset>
  )
}

// One desktop lane's chrome, shared by the static and draggable paths: the col-head (status pill
// + a count pushed to the inline-end) above the col-body. The `muted` tray surface is gone (owner
// call 2026-08-12) — cards sit directly on the page, whitespace separates the lanes, and the head
// alone names the column (still needed at `lg`, where all three lanes show at once; the mobile
// frame drops this section entirely — its pill tabs already name the visible lane). `bodyRef` and
// `over` are supplied by the draggable path to make the body a drop target that lights up when a
// card hovers it. `footer` seats the lane's pager strip below the body; the head's count always
// names the lane's whole population, not the visible page.
function LaneSection({
  column,
  bodyRef,
  over,
  footer,
  children,
}: {
  column: StatusColumn
  bodyRef?: (node: HTMLElement | null) => void
  over?: boolean
  footer?: ReactNode
  children: ReactNode
}) {
  const t = useTranslations()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3.5 rounded-lg bg-lane p-2.5">
      <header className="flex items-center gap-[9px] border-b border-border px-0.5 pb-2.5">
        {/* The lane head, recut to The Counter (round 8): the status dot beside the lane's
            name in full ink, the count in a small bordered pill right beside it, the whole
            head seated on a 2px baseline rule. The dot is decorative; the label carries the
            meaning. */}
        <h2 id={headingId} className="min-w-0">
          <span className="inline-flex items-center gap-2 text-body font-bold text-foreground">
            <span
              aria-hidden="true"
              className={cn('size-[7px] shrink-0 rounded-full', STATUS_DOT[column.status])}
            />
            {t(taskStatusLabelKey(column.status))}
          </span>
        </h2>
        <span className="rounded-full border border-border bg-card px-2 text-caption font-semibold leading-[18px] tabular-nums text-muted-foreground">
          {column.tasks.length}
        </span>
      </header>
      <ul
        ref={bodyRef}
        className={cn(
          // 11px between cards (The Counter, 2026-08-14 — the artifact's own card rhythm).
          'bb-stagger flex min-h-11 flex-col gap-[11px] rounded-md',
          // Light the lane while a card hovers it, so a drop target reads clearly mid-drag.
          over && 'outline-2 outline-offset-2 outline-ring',
        )}
      >
        {children}
      </ul>
      {footer}
    </section>
  )
}

// The board's page state and slicing (owner call 2026-08, the CRM's per-column pager): each lane
// pages independently at BOARD_PAGE_SIZE, and the page is clamped on read so a lane shrinking
// under the view (a delete, a cross-lane move, the priority lens) can never strand it on a page
// that no longer exists.
function pageLane(tasks: Task[], rawPage: number) {
  const pageCount = Math.max(1, Math.ceil(tasks.length / BOARD_PAGE_SIZE))
  const page = Math.min(rawPage, pageCount - 1)
  const start = page * BOARD_PAGE_SIZE
  const visible = tasks.slice(start, start + BOARD_PAGE_SIZE)
  return { page, pageCount, start, visible }
}

// A card the caller renders, made draggable: the grip (inside the card, at the inline-start) owns
// the gesture; the whole card lifts and slides via the sortable transform. `renderCard` is the
// screen's card factory — the grip is threaded into it so the card places its own handle.
function SortableCard({
  task,
  renderCard,
  moveOnly,
}: {
  task: Task
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
  // status-only drag: the grip announces "move", not "reorder" — the gesture can only change lanes.
  moveOnly: boolean
}) {
  const t = useTranslations()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = { transform: CSS.Transform.toString(transform), transition }

  const grip = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      // The grip is the one drag affordance, kept apart from the overflow menu so its actions stay
      // ordinary clicks. touch-none hands the gesture to the pointer sensor rather than letting the
      // page scroll it — required for drag on the touch (Capacitor) target. The 44px square clears
      // the touch floor; the resting glyph is the quiet low-opacity grip the mockup draws.
      aria-label={t(moveOnly ? 'tasks.dragMoveHandle' : 'tasks.dragHandle', { title: task.title })}
      className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
    >
      <Icon name="drag" />
    </button>
  )

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Lift the card while dragging and keep it above its neighbours so it slides over them.
      className={cn(isDragging && 'relative z-10 opacity-70')}
    >
      {renderCard(task, grip)}
    </li>
  )
}

// A draggable lane: the col-body is a droppable keyed by its status, so a card dropped onto the
// lane's empty space (not onto a card) still resolves to a status change. Its visible page of
// cards forms a SortableContext so a within-lane drag reorders; a drag can't cross pages, the
// same trade the reference CRM makes.
function DroppableLane({
  column,
  visible,
  footer,
  renderCard,
  moveOnly,
}: {
  column: StatusColumn
  visible: Task[]
  footer?: ReactNode
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
  moveOnly: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })
  return (
    <LaneSection column={column} bodyRef={setNodeRef} over={isOver} footer={footer}>
      <SortableContext
        items={visible.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {visible.map((task) => (
          <SortableCard key={task.id} task={task} renderCard={renderCard} moveOnly={moveOnly} />
        ))}
      </SortableContext>
    </LaneSection>
  )
}

export function StatusBoard({
  columns,
  renderCard,
  drag,
  onReorder,
  onStatusMove,
}: {
  columns: StatusColumn[]
  // The screen's card factory: a managed card for a writer, a status card for an employee. The
  // second argument is the drag grip, supplied only on the draggable path.
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
  drag: BoardDragMode
  // A within-lane reorder: the dragged card and the card it landed on (the existing position write).
  onReorder: (activeId: string, overId: string) => void
  // A cross-lane move: the dragged card and the lane's status (the existing status write).
  onStatusMove: (taskId: string, status: TaskStatus) => void
}) {
  const t = useTranslations()
  // A small activation distance keeps a focus-tap on the grip from registering as a drag; the
  // keyboard sensor makes the board operable without a pointer (dnd-kit announces the moves). Hooks
  // run unconditionally — a non-draggable board simply never opens a DndContext to use them.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // The width split is in JS, not CSS, so only one board structure mounts at a time — a CSS-hidden
  // twin would double every card (and its sortable id) in the DOM. Same query and reasoning as the
  // assistant's thread rail. The active tab survives a resize; it simply stops mattering at `lg`.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [activeStatus, setActiveStatus] = useState<TaskStatus>('not_started')

  // Each lane's 0-based page (the CRM pager). Stored raw and clamped on read by pageLane, so a
  // shrinking lane self-corrects without an effect.
  const [lanePage, setLanePage] = useState<Record<TaskStatus, number>>({
    not_started: 0,
    in_progress: 0,
    done: 0,
  })

  // One lane's visible slice and (when it overflows a page) its pager strip.
  const laneView = (column: StatusColumn) => {
    const { page, pageCount, start, visible } = pageLane(column.tasks, lanePage[column.status])
    const footer =
      pageCount > 1 ? (
        <ColumnPager
          page={page}
          pageCount={pageCount}
          from={start + 1}
          to={start + visible.length}
          total={column.tasks.length}
          onPrev={() =>
            setLanePage((prev) => ({ ...prev, [column.status]: Math.max(0, page - 1) }))
          }
          onNext={() =>
            setLanePage((prev) => ({ ...prev, [column.status]: Math.min(pageCount - 1, page + 1) }))
          }
        />
      ) : undefined
    return { visible, footer }
  }

  const flat = columns.flatMap((column) => column.tasks)
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const drop = resolveDrop(flat, String(active.id), String(over.id))
    if (!drop) return
    if (drop.kind === 'status') onStatusMove(drop.taskId, drop.status)
    // status-only drag: a within-lane drop is a reorder the viewer may not write — the card simply
    // settles back where it was, and nothing is patched or sent.
    else if (drag === 'full') onReorder(drop.activeId, drop.overId)
  }

  if (!isDesktop) {
    // The tabbed single-lane mobile board. `columns` always carries all three lanes (groupByStatus
    // builds from the fixed status order), so the find never misses; the empty fallback only
    // satisfies the type. No LaneSection here (owner call 2026-08-12): the active pill already
    // names the lane and its count, so the cards start straight under the tab row.
    const activeColumn = columns.find((column) => column.status === activeStatus) ?? {
      status: activeStatus,
      tasks: [],
    }
    // No drag on the tabbed board at any drag mode (owner call 2026-08-11). Only one lane is
    // mounted here, so a drag could never resolve to a status change — every drop lands back in
    // the lane it started in — leaving a grip that promised more than the gesture could deliver.
    // Both writes ride the StatusControl pill and the card's "Move to…" menu instead, which are
    // also the accessible path the grip's keyboard sensor used to cover.
    const activeView = laneView(activeColumn)
    return (
      <div className="flex flex-col gap-3.5">
        <StatusTabs columns={columns} active={activeStatus} onSelect={setActiveStatus} />
        <ul
          aria-label={t(taskStatusLabelKey(activeColumn.status))}
          className="bb-stagger flex flex-col gap-[11px]"
        >
          {activeView.visible.map((task) => (
            <li key={task.id}>{renderCard(task)}</li>
          ))}
        </ul>
        {activeView.footer}
      </div>
    )
  }

  if (drag === 'off') {
    return (
      <BoardGrid>
        {columns.map((column) => {
          const view = laneView(column)
          return (
            <LaneSection key={column.status} column={column} footer={view.footer}>
              {view.visible.map((task) => (
                <li key={task.id}>{renderCard(task)}</li>
              ))}
            </LaneSection>
          )
        })}
      </BoardGrid>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <BoardGrid>
        {columns.map((column) => {
          const view = laneView(column)
          return (
            <DroppableLane
              key={column.status}
              column={column}
              visible={view.visible}
              footer={view.footer}
              renderCard={renderCard}
              moveOnly={drag === 'status-only'}
            />
          )
        })}
      </BoardGrid>
    </DndContext>
  )
}
