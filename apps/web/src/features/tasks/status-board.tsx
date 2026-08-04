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
import { type ReactNode, useId } from 'react'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { cn } from '../../lib/cn.js'
import { STATUS_ICON, type StatusColumn, resolveDrop } from './board-columns.js'

// The 3-column status kanban that reshapes the board body (#214, task-board mockup §Board body /
// §Column). Below `lg` the three lanes stack as full-width, open status sections (a header + its
// cards); at `lg` they become a `repeat(3,1fr)` grid of `muted`-surface trays, top-aligned. The
// same layout renders for every viewer — an employee, a writer with the priority lens on, a writer
// dragging — only the card (managed vs status) and whether drag is offered differ.
//
// Drag is reinterpreted here (the behaviour change the mockup fixed): a cross-lane drop is a
// *status change* (the target lane's status), a within-lane drop is a *reorder* (the shared
// `position`). The screen owns both writes; this only resolves a drop to one or the other and calls
// up. The priority lens disables drag entirely (`draggable=false`), scoped now per-column.

// The responsive frame: stacked sections below `lg`, a three-lane grid at `lg` (`space-lg` gap,
// top-aligned so a tall lane never stretches its neighbours). The frame is width-agnostic — the
// shell's content-inner already caps and centres it (30rem mobile, 70rem from `md`).
function BoardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-lg lg:grid lg:grid-cols-3 lg:items-start lg:gap-lg">
      {children}
    </div>
  )
}

// One lane's chrome, shared by the static and draggable paths: the col-head (status glyph + label +
// a tabular count pushed to the inline-end) above the col-body. The `muted` tray surface and its
// padding appear only at `lg`; below it the section is open. `bodyRef` and `over` are supplied by
// the draggable path to make the body a drop target that lights up when a card hovers it.
function LaneSection({
  column,
  bodyRef,
  over,
  children,
}: {
  column: StatusColumn
  bodyRef?: (node: HTMLElement | null) => void
  over?: boolean
  children: ReactNode
}) {
  const t = useTranslations()
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-sm lg:rounded-lg lg:bg-muted lg:p-sm"
    >
      <header className="flex items-center gap-2 px-1">
        <Icon name={STATUS_ICON[column.status]} />
        <h2 id={headingId} className="text-label font-semibold text-foreground">
          {t(taskStatusLabelKey(column.status))}
        </h2>
        <span className="ms-auto text-label font-semibold tabular-nums text-muted-foreground">
          {column.tasks.length}
        </span>
      </header>
      <ul
        ref={bodyRef}
        className={cn(
          'flex min-h-11 flex-col gap-sm rounded-md',
          // Light the lane while a card hovers it, so a drop target reads clearly mid-drag.
          over && 'outline-2 outline-offset-2 outline-ring',
        )}
      >
        {children}
      </ul>
    </section>
  )
}

// A card the caller renders, made draggable: the grip (inside the card, at the inline-start) owns
// the gesture; the whole card lifts and slides via the sortable transform. `renderCard` is the
// screen's card factory — the grip is threaded into it so the card places its own handle.
function SortableCard({
  task,
  renderCard,
}: {
  task: Task
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
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
      aria-label={t('tasks.dragHandle', { title: task.title })}
      className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-muted hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
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
// lane's empty space (not onto a card) still resolves to a status change. Its cards form a
// SortableContext so a within-lane drag reorders.
function DroppableLane({
  column,
  renderCard,
}: {
  column: StatusColumn
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status })
  return (
    <LaneSection column={column} bodyRef={setNodeRef} over={isOver}>
      <SortableContext
        items={column.tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        {column.tasks.map((task) => (
          <SortableCard key={task.id} task={task} renderCard={renderCard} />
        ))}
      </SortableContext>
    </LaneSection>
  )
}

export function StatusBoard({
  columns,
  renderCard,
  draggable,
  onReorder,
  onStatusMove,
}: {
  columns: StatusColumn[]
  // The screen's card factory: a managed card for a writer, a status card for an employee. The
  // second argument is the drag grip, supplied only on the draggable path.
  renderCard: (task: Task, grip?: ReactNode) => ReactNode
  draggable: boolean
  // A within-lane reorder: the dragged card and the card it landed on (the existing position write).
  onReorder: (activeId: string, overId: string) => void
  // A cross-lane move: the dragged card and the lane's status (the existing status write).
  onStatusMove: (taskId: string, status: TaskStatus) => void
}) {
  // A small activation distance keeps a focus-tap on the grip from registering as a drag; the
  // keyboard sensor makes the board operable without a pointer (dnd-kit announces the moves). Hooks
  // run unconditionally — a non-draggable board simply never opens a DndContext to use them.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!draggable) {
    return (
      <BoardGrid>
        {columns.map((column) => (
          <LaneSection key={column.status} column={column}>
            {column.tasks.map((task) => (
              <li key={task.id}>{renderCard(task)}</li>
            ))}
          </LaneSection>
        ))}
      </BoardGrid>
    )
  }

  const flat = columns.flatMap((column) => column.tasks)
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const drop = resolveDrop(flat, String(active.id), String(over.id))
    if (!drop) return
    if (drop.kind === 'status') onStatusMove(drop.taskId, drop.status)
    else onReorder(drop.activeId, drop.overId)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <BoardGrid>
        {columns.map((column) => (
          <DroppableLane key={column.status} column={column} renderCard={renderCard} />
        ))}
      </BoardGrid>
    </DndContext>
  )
}
