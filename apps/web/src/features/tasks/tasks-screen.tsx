import type { ReorderTasksRequest, Task, TaskBoardResponse, TaskStatus } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from '../people/user-list.js'
import { groupByStatus } from './board-columns.js'
import { BoardEmpty, BoardError, BoardLoading } from './board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { ManagedTaskCard } from './managed-task-card.js'
import { applyReorder } from './reorder.js'
import { StatusBoard } from './status-board.js'
import { StatusTaskCard } from './status-task-card.js'
import { TaskFormSheet } from './task-form-sheet.js'

const priorityRank: Record<Task['priority'], number> = { high: 3, normal: 2, low: 1 }

// The create/edit sheet the board owns: closed (null), creating, or editing one task. One sheet
// opens over the whole board — a bottom sheet on mobile, an inline-end drawer on desktop — rather
// than each card mounting its own form (#215).
type SheetState = { mode: 'create' } | { mode: 'edit'; task: Task } | null

// The high→low priority sort is a per-viewer lens over the server's shared manual order. It never
// asks the server to reorder and never touches `position`: it sorts a *copy* by priority, and
// because Array.prototype.sort is stable, same-priority tasks keep the manual order they arrived in
// — the stable tiebreak the board promises. Turning the toggle off simply renders the server list
// as-is, restoring the manual order. Drag (#135, Slice D) is disabled while this lens is on, so the
// two never fight: a writer reorders the shared `position` order only when viewing that order.
function orderTasks(tasks: Task[], sortByPriority: boolean): Task[] {
  if (!sortByPriority) return tasks
  return [...tasks].sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])
}

// The task board — the app's home surface after login (#131, Slice A). It renders the scoped read:
// what the caller sees (their own assigned tasks, their location, or the whole chain) is decided by
// the API from the principal, never asked for here. Opening the board is also the last-seen trigger
// — this read bumps the per-user marker server-side, which #59's Tasks-tab badge later reads.
export function TasksScreen() {
  const t = useTranslations()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [sortByPriority, setSortByPriority] = useState(false)
  // The desktop content-header's search: a per-viewer client filter over the loaded titles. It
  // never hits the server (the board is one location's tasks) and, like the priority lens, it is a
  // view the manual-order drag does not apply under.
  const [search, setSearch] = useState('')
  const [sheet, setSheet] = useState<SheetState>(null)
  const query = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  // Subscribe to the live channel (#132): scope-filtered changes patch the query cache in place, so
  // the board stays fresh without polling. The plain read above is the fallback if the channel is
  // unavailable.
  useBoardStream()

  // The last-seen trigger (#136): the board read itself always peeks (the shell's badge polls the
  // same query, and a background poll must not count as seeing anything), so the user's actual
  // visit is reported here — once on mount and again on unmount, so tasks streamed in mid-visit
  // are seen too. The cached marker is patched from the response, clearing the badge in place; a
  // failed bump is dropped (the badge is best-effort, never worth an error surface).
  useEffect(() => {
    const bump = () => {
      tasksApi
        .markSeen()
        .then(({ lastSeenAt }) => {
          queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
            prev ? { ...prev, lastSeenAt } : prev,
          )
        })
        .catch(() => {})
    }
    bump()
    return bump
  }, [queryClient])

  // Only a manager or admin writes to the board (#133); an employee sees a read-only board (the API
  // refuses their writes regardless). The people read backs the assignee picker — it needs the
  // provisioning surface's scoped list, so it runs only for a writer, who is allowed that read.
  const canWrite = principal ? principal.role !== 'employee' : false
  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: authApi.listUsers,
    enabled: canWrite,
  })
  const users = usersQuery.data?.users ?? []

  // An admin's lanes mix every location's tasks, so each card carries a branch chip naming its
  // board. The names come from the same admin-only Location list the create form uses (#164);
  // a manager or employee only ever sees their own location, so the query stays off and the
  // chip is never rendered for them. A name still loading renders no chip rather than a raw id.
  const isAdmin = principal?.role === 'admin'
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locationNames = new Map(
    (locationsQuery.data ?? []).map((location) => [location.id, location.name]),
  )

  const tasks = query.data?.tasks ?? []
  // The search is a case-insensitive title filter; a blank search shows the whole board unchanged,
  // so the manual order and drag are untouched in the common case.
  const term = search.trim().toLowerCase()
  const visibleTasks =
    term === '' ? tasks : tasks.filter((task) => task.title.toLowerCase().includes(term))

  // The shared-order write (#135, Slice D). Only a manager or admin reaches it (the drag surface is
  // theirs alone), and the API re-authorises by scope regardless (ADR-0007). The board is patched
  // optimistically the instant a drop lands — below, before this fires — so the move never waits on
  // the network; a failure rolls back by refetching the server's truth, and a success needs no work
  // because the reorder's own live events re-confirm the same order on this and every other board.
  const reorderMutation = useMutation({
    mutationFn: (command: ReorderTasksRequest) =>
      tasksApi.reorderTasks(command.orderedIds, command.locationId),
    onError: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  // A within-lane drop names the dragged task and the slot it landed on. Resolve it to the
  // optimistic board and the scoped command (a no-op or unknown id yields null and is dropped),
  // patch the cache so the new order shows at once, then send the write. `tasks` is the shared
  // manual order here — drag is only offered while the priority lens is off and no search is active.
  const handleReorder = (activeId: string, overId: string) => {
    const result = applyReorder(tasks, activeId, overId)
    if (!result) return
    queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
      prev ? { ...prev, tasks: result.tasks } : prev,
    )
    reorderMutation.mutate(result.command)
  }

  // The cross-lane write (#214): dragging a card to another lane sets its status to that lane, via
  // the same status endpoint the card's "Move to…" menu uses. Optimistic like the reorder — the
  // card jumps to the target lane at once — and a failure rolls back by refetching the server's
  // truth, surfaced as the inline Alert above the board. The refetch on success reconciles the
  // trigger-maintained completed_at a done move earns.
  const statusMoveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      tasksApi.updateTaskStatus(taskId, status),
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  const handleStatusMove = (taskId: string, status: TaskStatus) => {
    queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
          }
        : prev,
    )
    statusMoveMutation.mutate({ taskId, status })
  }

  // A writer viewing the shared manual order may drag (to reorder within a lane or set status
  // across lanes); the priority lens and an active search both disable drag (they are per-viewer
  // views, not the order the write sets), and an employee never drags.
  const canReorder = canWrite && !sortByPriority && term === ''
  const openCreate = () => setSheet({ mode: 'create' })
  const openEdit = (task: Task) => setSheet({ mode: 'edit', task })

  // The board split into its three status lanes, the priority lens applied *within* each lane so a
  // writer scans each column high→low without the sort ever touching status or the shared order.
  // The columns are built from the searched view, so a filter narrows each lane in place.
  const columns = groupByStatus(visibleTasks).map((column) => ({
    ...column,
    tasks: orderTasks(column.tasks, sortByPriority),
  }))

  // The card each lane renders: a writer's managed card (with the drag grip when draggable, and the
  // overflow Edit routed up to the shared sheet) or an employee's read-only status card.
  const renderCard = (task: Task, grip?: ReactNode) =>
    canWrite && principal ? (
      <ManagedTaskCard
        task={task}
        onEdit={openEdit}
        grip={grip}
        locationName={isAdmin ? locationNames.get(task.locationId) : undefined}
      />
    ) : (
      <StatusTaskCard task={task} />
    )

  return (
    <section className="flex flex-col gap-4">
      {/* Content-header (shell content-header pattern): the screen title at the inline-start and,
          at the inline-end, the board's action cluster — Search (desktop only, per shell), the
          Sort-by-priority lens (every breakpoint), and New task (desktop; mobile uses the FAB). */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <h1 className="text-heading-lg font-semibold text-foreground">{t('tasks.title')}</h1>
        <div className="flex items-center gap-2">
          {/* The search rides only the desktop content-header (shell decision): the mobile board is
              a short scannable list that needs no filter. */}
          {canWrite ? (
            <div className="relative hidden md:block">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
                <Icon name="search" size="sm" />
              </span>
              <Input
                type="search"
                aria-label={t('tasks.searchPlaceholder')}
                placeholder={t('tasks.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-56 ps-9"
              />
            </div>
          ) : null}
          {tasks.length > 0 ? (
            <Button
              variant={sortByPriority ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={sortByPriority}
              onClick={() => setSortByPriority((on) => !on)}
            >
              {sortByPriority ? t('tasks.manualOrder') : t('tasks.sortByPriority')}
            </Button>
          ) : null}
          {canWrite ? (
            <Button size="sm" className="hidden md:inline-flex" onClick={openCreate}>
              <Icon name="create" size="sm" />
              {t('tasks.newTask')}
            </Button>
          ) : null}
        </div>
      </div>

      {query.isPending ? (
        <BoardLoading />
      ) : query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : tasks.length === 0 ? (
        <BoardEmpty canCreate={canWrite} onCreate={openCreate} />
      ) : (
        <>
          {/* A failed drag rolled the board back to the server's truth; tell the writer so a lost
              move is not silent. Optimism means the common path shows nothing here — a reorder and
              a cross-lane status move each surface their own line. */}
          {reorderMutation.isError ? <Alert tone="error">{t('tasks.reorderFailed')}</Alert> : null}
          {statusMoveMutation.isError ? (
            <Alert tone="error">{t('tasks.statusFailed')}</Alert>
          ) : null}
          {/* Announce the active sort for assistive tech without a visible duplicate of the toggle. */}
          <p className="sr-only" aria-live="polite">
            {sortByPriority ? t('tasks.sortByPriorityOn') : ''}
          </p>
          {visibleTasks.length === 0 ? (
            // A non-empty board a search narrowed to nothing: a plain line, not the empty state.
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('tasks.searchNoMatches')}
            </p>
          ) : (
            // The 3-column status kanban (#214): stacked lanes below lg, a three-lane grid at lg. A
            // writer viewing the shared manual order drags to reorder within a lane or set status
            // across lanes; the priority lens, an active search, and an employee get the same lanes
            // without drag.
            <StatusBoard
              columns={columns}
              renderCard={renderCard}
              draggable={canReorder && principal !== null}
              onReorder={handleReorder}
              onStatusMove={handleStatusMove}
            />
          )}
        </>
      )}

      {/* Mobile Create FAB — the shell reserves the primary create action to the screen (#207);
          the board owns it. Hidden from md, where the content-header's New task takes over. It
          floats clear of the fixed tab bar and the phone's home indicator. */}
      {canWrite ? (
        <Button
          aria-label={t('tasks.newTask')}
          onClick={openCreate}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] end-4 z-30 size-14 rounded-full p-0 shadow-md md:hidden"
        >
          <Icon name="create" size="lg" />
        </Button>
      ) : null}

      {/* The one create/edit sheet, mounted only while open so its react-hook-form state resets each
          time. Gated to a writer with a resolved principal. */}
      {canWrite && principal && sheet ? (
        <TaskFormSheet
          mode={sheet.mode}
          principal={principal}
          users={users}
          task={sheet.mode === 'edit' ? sheet.task : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </section>
  )
}
