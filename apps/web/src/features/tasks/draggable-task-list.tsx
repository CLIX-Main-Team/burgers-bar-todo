import type { PrincipalResponse, Task, UserSummary } from '@burgers/shared'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
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
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { ManagedTaskCard } from './managed-task-card.js'

// The manager/admin drag-reorder surface (#135, Slice D). It renders the writer's board as a
// sortable list, each card carrying a grip handle that starts a drag; a drop calls `onReorder` up to
// the screen, which owns the query cache and the API write. This list is mounted only when drag is
// allowed — a writer with the priority sort off — so it never has to reason about the sort lens or an
// employee (they get the plain read-only list): here, every card drags. Pointer and keyboard sensors
// both drive it, so reorder works by touch on the Capacitor build, by mouse, and by keyboard.

// One draggable card: the grip handle owns the drag (the card keeps its own edit/delete controls
// clickable), and the whole row lifts and slides via the sortable transform.
function SortableTaskItem({
  task,
  users,
  principal,
}: {
  task: Task
  users: UserSummary[]
  principal: PrincipalResponse
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Lift the row while it is being dragged, and keep it above its neighbours so it slides over
      // them rather than under. z-10 only matters mid-drag; opacity gives the picked-up feel.
      className={cn('flex items-start gap-2', isDragging && 'relative z-10 opacity-70')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        // The handle is the one drag affordance, kept off the card body so the card's edit/delete
        // buttons stay ordinary clicks. touch-none hands the gesture to the pointer sensor instead of
        // letting the page scroll it — required for drag to work on the touch (Capacitor) target.
        aria-label={t('tasks.dragHandle', { title: task.title })}
        className="mt-1 flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <Icon name="drag" />
      </button>
      <div className="min-w-0 flex-1">
        <ManagedTaskCard task={task} users={users} principal={principal} />
      </div>
    </li>
  )
}

export function DraggableTaskList({
  tasks,
  users,
  principal,
  onReorder,
}: {
  tasks: Task[]
  users: UserSummary[]
  principal: PrincipalResponse
  // Called with the dragged task id and the id of the slot it was dropped on. The screen turns this
  // into the optimistic board and the scoped API write; a no-op drop is filtered here so it never fires.
  onReorder: (activeId: string, overId: string) => void
}) {
  // A small activation distance keeps a focus-tap on the handle from registering as a drag, and the
  // keyboard sensor makes the reorder operable without a pointer at all (dnd-kit announces the moves).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id))
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-3">
          {tasks.map((task) => (
            <SortableTaskItem key={task.id} task={task} users={users} principal={principal} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
