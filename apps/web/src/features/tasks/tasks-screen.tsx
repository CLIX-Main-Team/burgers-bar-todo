import {
  type ReorderTasksRequest,
  type Role,
  type Task,
  type TaskBoardResponse,
  type TaskStatus,
  isSuperAdmin,
} from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslations } from 'use-intl'
import { hasCapability } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from '../people/user-list.js'
import { groupByStatus } from './board-columns.js'
import { BoardEmpty, BoardError, BoardLoading } from './board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { BoardTaskCard } from './board-task-card.js'
import { FilterAvatar, type FilterChoice, FilterMenu } from './filter-menu.js'
import { peopleForFacets, personSurvives, rolesForBranch } from './filter-options.js'
import { PersonalTaskDialog } from './personal-task-dialog.js'
import { applyReorder } from './reorder.js'
import { type BoardDragMode, StatusBoard } from './status-board.js'
import { StatusTaskCard } from './status-task-card.js'
import {
  ANY_FILTER,
  BACKLOG_FILTER,
  type TaskLenses,
  type TaskScope,
  type TaskView,
  applyLenses,
  hasActiveLens,
} from './task-filters.js'
import { TaskFormDialog } from './task-form-dialog.js'
import { TaskList } from './task-list.js'

// normal is the FLOOR now, not the middle (owner call 2026-08-21): a task starts at normal
// and is raised from there, so the sort reads high, then medium, then everything untouched.
const priorityRank: Record<Task['priority'], number> = { high: 3, medium: 2, normal: 1 }

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
  const { locale } = useLocale()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [sortByPriority, setSortByPriority] = useState(false)
  // The desktop content-header's search: a per-viewer client filter over the loaded titles. It
  // never hits the server (the board is one location's tasks) and, like the priority lens, it is a
  // view the manual-order drag does not apply under.
  const [search, setSearch] = useState('')
  // The v2 lenses (2026-08-20). All four are per-viewer view state and none is persisted: the board
  // is a shared surface, so it opens the same way for everyone every time, and a lens is something
  // you reach for rather than something you inherit from your last visit.
  const [scope, setScope] = useState<TaskScope>('all')
  const [view, setView] = useState<TaskView>('board')
  const [branchFilter, setBranchFilter] = useState(ANY_FILTER)
  const [assigneeFilter, setAssigneeFilter] = useState(ANY_FILTER)
  const [roleFilter, setRoleFilter] = useState<Role | typeof ANY_FILTER>(ANY_FILTER)
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

  // A writer holds tasks.manage (a capability the owner edits from the Access page since
  // 2026-08-24, defaulting to manager-and-up); everyone else sees a read-only shared board (the
  // API refuses their writes regardless). tasks.createPersonal is a separate, narrower thing that
  // every role holds by default (2026-08-25): a private list of one's own. The people read backs
  // the assignee picker, so it runs only for a full writer.
  const canWrite = principal ? hasCapability(principal, 'tasks.manage') : false
  const canCreatePersonal = principal ? hasCapability(principal, 'tasks.createPersonal') : false
  // What the private-task dialog is doing: absent when closed, `{}` for a new one, or the task
  // being edited. One piece of state rather than a boolean plus a task, so the two can never
  // disagree about which of the two the dialog is showing.
  const [personalEdit, setPersonalEdit] = useState<{ task?: Task } | null>(null)
  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: authApi.listUsers,
    enabled: canWrite,
  })
  const users = usersQuery.data?.users ?? []

  // A super_admin's lanes mix every location's tasks, so each card carries a branch chip
  // naming its board. The names come from the same admin-only Location list the create form
  // uses (#164); a manager, a branch admin, or an employee only ever sees their own location,
  // so the query stays off and the chip is never rendered for them — grouping by branch only
  // means something chain-wide. A name still loading renders no chip rather than a raw id.
  const isAdmin = principal ? isSuperAdmin(principal.role) : false
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locationNames = new Map(
    (locationsQuery.data ?? []).map((location) => [location.id, location.name]),
  )

  const tasks = query.data?.tasks ?? []

  // The header's subtitle (The Counter, round 8): the viewer's branch and today's date —
  // "Dizengoff · Wednesday, 13 Aug". The branch name comes from the viewer's own row in the
  // people read a writer already loads for the assignee picker (the principal carries only a
  // location id); an admin is chain-wide (null name) and an employee never loads the list, so
  // both fall back to the date alone.
  const ownBranch = canWrite
    ? users.find((user) => user.id === principal?.userId)?.locationName
    : undefined
  const today = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date())
  const subtitle = ownBranch ? `${ownBranch} · ${today}` : today
  // The search is a case-insensitive title filter; a blank search shows the whole board unchanged,
  // so the manual order and drag are untouched in the common case.
  const term = search.trim().toLowerCase()
  // Everyone holding the chosen role, resolved from the people list the assignee picker already
  // loads. A task carries no role of its own, so this set is how the lens reaches one.
  const roleMemberIds =
    roleFilter === ANY_FILTER
      ? undefined
      : new Set(users.filter((user) => user.role === roleFilter).map((user) => user.id))
  const lenses: TaskLenses = {
    scope,
    branchId: branchFilter,
    assigneeId: assigneeFilter,
    role: roleFilter,
    roleMemberIds,
    term,
  }
  const visibleTasks = applyLenses(tasks, lenses)
  const lensActive = hasActiveLens(lenses)
  // Something the viewer can actually clear from the toolbar. The personal scope is not in it:
  // there the scope tabs are the way back, and offering "Clear filters" beside no filters reads
  // as a broken control.
  const clearableLens =
    branchFilter !== ANY_FILTER ||
    assigneeFilter !== ANY_FILTER ||
    roleFilter !== ANY_FILTER ||
    term !== ''
  // Each tab's count is that tab's own board with every OTHER lens already applied, so the number
  // beside a tab still holds after it is pressed. The two are disjoint sets of rows since
  // 2026-08-25 (private work is not a slice of the shared board), so each is counted on its own.
  const scopeTabs: { id: TaskScope; label: string; count: number }[] = [
    {
      id: 'personal',
      label: t('tasks.personalTasks'),
      count: applyLenses(tasks, { ...lenses, scope: 'personal' }).length,
    },
    {
      id: 'all',
      label: t('tasks.allTasks'),
      count: applyLenses(tasks, { ...lenses, scope: 'all' }).length,
    },
  ]

  // Whether the facet group has anything in it at all. The three facets each have their own
  // condition below; this is their disjunction, so the group's label never renders alone.
  const showFacets = isAdmin || canWrite
  // The branch filter only exists for a viewer whose board mixes branches, which is the two admin
  // roles alone; a manager and an employee see one location and would be choosing between one
  // option. The role and person filters are a writer's tools - both read the same scoped people
  // list the assignee picker already loaded, so neither costs a request.
  const branchChoices: FilterChoice[] = (locationsQuery.data ?? []).map((location) => ({
    value: location.id,
    label: location.name,
    lead: <Icon name="manage-locations" size="sm" className="flex-none text-muted-foreground" />,
  }))
  // The three facets narrow each OTHER, not only the board (owner ask 2026-08-21). Branch and
  // role are properties of a person, so what each filter may offer is whatever survives the
  // filters above it: choose Dizengoff and the role list keeps the roles worked there, choose
  // Manager and the person list keeps the managers. The reasoning, and why the branch list is
  // never itself narrowed, is in filter-options.ts.
  //
  // Only the roles somebody actually holds. Offering "Admin" on a board with no admin on it is
  // a filter that can only ever empty the screen — the same reason the narrowing exists at all.
  const roleChoices: FilterChoice[] = rolesForBranch(users, branchFilter).map((role) => ({
    value: role,
    label: t(roleLabelKey(role)),
    lead: <Icon name="role" size="sm" className="flex-none text-muted-foreground" />,
    meta: String(peopleForFacets(users, branchFilter, role).length),
  }))
  const personChoices: FilterChoice[] = [
    // The backlog pile is dropped once a role is chosen: a task with nobody on it has nobody to
    // hold one, so the pair can only ever come up empty.
    ...(roleFilter === ANY_FILTER
      ? [
          {
            value: BACKLOG_FILTER,
            label: t('tasks.filterBacklog'),
            lead: <Icon name="backlog" size="sm" className="flex-none text-muted-foreground" />,
          },
        ]
      : []),
    ...peopleForFacets(users, branchFilter, roleFilter).map((user) => ({
      value: user.id,
      label: user.displayName,
      lead: <FilterAvatar name={user.displayName} />,
      meta: t(roleLabelKey(user.role)),
    })),
  ]
  const clearFacets = () => {
    setBranchFilter(ANY_FILTER)
    setAssigneeFilter(ANY_FILTER)
    setRoleFilter(ANY_FILTER)
  }
  const clearLenses = () => {
    setScope('all')
    clearFacets()
    setSearch('')
  }
  // Personal tasks are, by definition, this account's own (owner call 2026-08-21), so the three
  // facets are not merely hidden there - they are dropped, and any that were set are released.
  // A filter that keeps narrowing a board while its control is off screen is a trap.
  const selectScope = (next: TaskScope) => {
    setScope(next)
    if (next === 'personal') clearFacets()
  }
  // Narrowing a facet releases anything below it that the new choice makes impossible. Without
  // this the board would keep filtering by a person its own person filter no longer offers —
  // an empty board narrowed by something you cannot find a control for, and the chip's × the
  // only way back. Cleared silently on purpose: the chip vanishing beside the one just pressed
  // IS the feedback, and it happens where the eye already is.
  const selectBranch = (next: string) => {
    setBranchFilter(next)
    const role: Role | typeof ANY_FILTER =
      roleFilter !== ANY_FILTER && !rolesForBranch(users, next).includes(roleFilter)
        ? ANY_FILTER
        : roleFilter
    if (role !== roleFilter) setRoleFilter(role)
    if (!personSurvives(users, assigneeFilter, next, role)) setAssigneeFilter(ANY_FILTER)
  }
  const selectRole = (next: Role | typeof ANY_FILTER) => {
    setRoleFilter(next)
    if (!personSurvives(users, assigneeFilter, branchFilter, next)) setAssigneeFilter(ANY_FILTER)
  }

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

  // A writer viewing the shared manual order may drag fully (reorder within a lane, set status
  // across lanes). An employee drags in status-only mode: crossing lanes is the one write their
  // role has — the same status change their card's pill makes — while a within-lane drop resolves
  // to nothing (the shared order is a manager's write).
  //
  // Every per-viewer lens disables drag, for one reason: a narrowed or re-sorted board is not the
  // shared order, so a drop inside one would write a `position` the dragger cannot see. That covers
  // the priority sort, the search, the scope tabs and both filters alike.
  const canReorder = canWrite && !sortByPriority && !lensActive
  const dragMode: BoardDragMode = !principal
    ? 'off'
    : canWrite
      ? canReorder
        ? 'full'
        : 'off'
      : sortByPriority
        ? 'off'
        : 'status-only'
  // One entry point for "make a task", and the tab decides which kind: on the private board it
  // writes a private task, on the shared board it opens the full sheet. A manager holds both, so
  // inferring from their capabilities alone would make the private one unreachable for them.
  const canCreateHere = scope === 'personal' ? canCreatePersonal : canWrite
  const openCreate = () => {
    if (scope === 'personal') {
      if (canCreatePersonal) setPersonalEdit({})
    } else if (canWrite) {
      setSheet({ mode: 'create' })
    }
  }
  // A private task always opens its own editor, whoever is looking — and the person looking is
  // always its writer, since nobody else can see it. The board sheet would offer an assignee
  // picker and a branch (owner's report, 2026-08-25: "it shouldnt be assignable to anybody but
  // myself"), which is a choice this task does not have and the API refuses outright.
  const openEdit = (task: Task) =>
    task.personal ? setPersonalEdit({ task }) : setSheet({ mode: 'edit', task })

  // The board split into its three status lanes, the priority lens applied *within* each lane so a
  // writer scans each column high→low without the sort ever touching status or the shared order.
  // The columns are built from the searched view, so a filter narrows each lane in place.
  const columns = groupByStatus(visibleTasks).map((column) => ({
    ...column,
    tasks: orderTasks(column.tasks, sortByPriority),
  }))

  // The card each lane renders: a writer's board card (whole card opens the editor, status set
  // inline, drag grip when draggable) or an employee's status card — whose grip, when the
  // status-only drag mode threads one in, carries their lane-crossing status gesture.
  // The editable card on the private board too: its writer holds full control over their own
  // notes (2026-08-25), which is a different question from whether they run the shared board.
  const renderCard = (task: Task, grip?: ReactNode) =>
    (canWrite || (task.personal && canCreatePersonal)) && principal ? (
      <BoardTaskCard
        task={task}
        onOpen={openEdit}
        grip={grip}
        locationName={isAdmin && task.locationId ? locationNames.get(task.locationId) : undefined}
      />
    ) : (
      <StatusTaskCard task={task} grip={grip} />
    )

  return (
    // The mobile bottom padding is the FAB's landing space: it floats over this scroll region, so
    // without it the last card's overflow menu sits under the button at the end of a lane.
    <section data-fills-width className="flex flex-col gap-4.5 pb-20 md:pb-0">
      {/* Content-header, recut to The Counter's header grammar (round 8, 2026-08-14): the
          page name owns its line with the branch-and-date subtitle under it, and on desktop
          every action sits in a toolbar row directly BENEATH the name — Search, the
          Sort-by-priority lens, and the gold New task. On the phone the title row keeps its
          one quiet sort glyph at the inline-end (the live layout, kept by owner call) and
          create stays the floating FAB. */}
      <div className="flex flex-col items-start gap-[13px]">
        <div className="flex w-full items-center justify-between gap-4">
          <div>
            <h1 className="text-heading-lg font-extrabold text-foreground">{t('tasks.title')}</h1>
            {subtitle ? (
              <p className="mt-0.5 text-label text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {tasks.length > 0 ? (
            // The phone header's sort toggle — the row's only action below md.
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={sortByPriority}
              aria-label={sortByPriority ? t('tasks.manualOrder') : t('tasks.sortByPriority')}
              className={cn(
                'md:hidden',
                sortByPriority ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
              onClick={() => setSortByPriority((on) => !on)}
            >
              <Icon name="sort-priority" />
            </Button>
          ) : null}
        </div>

        {/* The phone's search, full width under the title (handoff §7). The desktop keeps
            its own 200px field in the toolbar row below, driving the same state. */}
        {canWrite ? (
          <div className="relative w-full md:hidden">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
              <Icon name="search" size="sm" />
            </span>
            <Input
              type="search"
              aria-label={t('tasks.searchPlaceholder')}
              placeholder={t('tasks.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full ps-9 text-label"
            />
          </div>
        ) : null}

        {/* The desktop toolbar row, under the name (owner call, rev 3: actions never float
            beside the title). 36px density — pointer-first chrome, the 44px floor is a
            touch rule. */}
        <div className="hidden flex-wrap items-center gap-[9px] md:flex">
          {canWrite ? (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
                <Icon name="search" size="sm" />
              </span>
              <Input
                type="search"
                aria-label={t('tasks.searchPlaceholder')}
                placeholder={t('tasks.searchPlaceholder')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-[200px] ps-9 text-label md:text-label"
              />
            </div>
          ) : null}
          {tasks.length > 0 ? (
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={sortByPriority}
              aria-label={sortByPriority ? t('tasks.manualOrder') : t('tasks.sortByPriority')}
              className={cn(
                // shadow-sm to match the search field it stands beside: same height, same
                // radius, 9px apart, so one of them lifting and the other lying flat read as
                // an accident rather than a rule.
                'rounded-md border border-border-strong bg-card shadow-sm',
                sortByPriority ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
              onClick={() => setSortByPriority((on) => !on)}
            >
              <Icon name="sort-priority" />
            </Button>
          ) : null}
          {canCreateHere ? (
            <Button onClick={openCreate}>
              <Icon name="create" size="sm" />
              {t('tasks.newTask')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* The lens bands (v2, 2026-08-20). Two rows, in the order a reader narrows: WHOSE tasks,
          then HOW they are laid out and which of them. Both are desktop-only — the phone board
          already spends its width on the status tabs, and stacking a second tab row plus two
          selects above four visible cards would leave no board. */}
      {tasks.length > 0 ? (
        <div className="hidden flex-col gap-3.5 md:flex">
          {/* Scope: the same underline-tab grammar the phone board uses for status, so the app
              has one selected-tab idiom rather than two. */}
          <fieldset
            aria-label={t('tasks.scopeTabs')}
            className="m-0 flex gap-[22px] border-b border-border p-0"
          >
            {scopeTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={scope === tab.id}
                onClick={() => selectScope(tab.id)}
                className={cn(
                  // One weight for both states — the label goes from muted to full ink and
                  // gains the gold underline, but never changes width (owner call 2026-08-21),
                  // so switching scope does not shove the tab beside it sideways.
                  'relative flex min-h-[38px] items-center gap-[7px] pb-[9px] text-body font-semibold',
                  'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  scope === tab.id ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {tab.label}
                <span className="text-caption font-medium tabular-nums text-muted-foreground">
                  {tab.count}
                </span>
                {scope === tab.id ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-gold"
                  />
                ) : null}
              </button>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* The view switcher (recut 2026-08-27 on the owner's call). It used to lift the
                selected half onto the card surface — a white pill on a muted track — which after
                the palette recut measured 1.28:1 against that track, below the step an eye can
                resolve, so neither half looked chosen. The selected half is now filled with the
                ink itself, the way the reference the owner sent marks its current tab. */}
            <fieldset
              aria-label={t('tasks.viewSwitch')}
              className="m-0 flex rounded-md border border-border-strong bg-card p-0.5"
            >
              {(
                [
                  { id: 'board', label: t('tasks.viewBoard'), icon: 'manage-locations' },
                  { id: 'list', label: t('tasks.viewList'), icon: 'tasks' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={view === option.id}
                  onClick={() => setView(option.id)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-caption font-semibold',
                    view === option.id
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon name={option.icon} size="sm" />
                  {option.label}
                </button>
              ))}
            </fieldset>

            <p className="text-caption tabular-nums whitespace-nowrap text-muted-foreground">
              {t('tasks.resultCount', { count: visibleTasks.length })}
            </p>

            {clearableLens ? (
              <Button variant="ghost" className="h-8 px-2 text-caption" onClick={clearLenses}>
                {t('tasks.clearFilters')}
              </Button>
            ) : null}

            {/* The three facets sit at the far inline-end, away from the view switch: one names
                what you are looking at, these narrow it. They are absent on the personal scope
                - those tasks are already yours, so there is nothing left to narrow by - and
                absent for a role that holds none of them, which is an employee: their board is
                their own assigned work, and a lone "Filter" label over no controls reads as a
                broken toolbar (owner call 2026-08-25). */}
            {scope === 'all' && showFacets ? (
              <div className="ms-auto flex flex-wrap items-center gap-2">
                {/* The word that names the group. Without it the three dashed boxes read as
                    empty fields waiting to be filled in rather than as the board's filters. */}
                <span className="text-caption font-semibold text-muted-foreground">
                  {t('tasks.filterLabel')}
                </span>
                {isAdmin ? (
                  <FilterMenu
                    facet={t('tasks.facetBranch')}
                    icon="manage-locations"
                    value={branchFilter}
                    choices={branchChoices}
                    anyLabel={t('tasks.filterAnyBranch')}
                    onChange={selectBranch}
                    clearLabel={t('tasks.clearFacet', { facet: t('tasks.facetBranch') })}
                  />
                ) : null}
                {/* Mounted on what the whole board holds, never on the narrowed list: a control
                    that disappeared the moment a branch was chosen would take its own undo with
                    it and shove the person filter sideways. Narrowed to nothing, it stays put
                    and goes quiet instead. */}
                {canWrite && rolesForBranch(users, ANY_FILTER).length > 1 ? (
                  <FilterMenu
                    facet={t('tasks.facetRole')}
                    icon="role"
                    value={roleFilter}
                    choices={roleChoices}
                    anyLabel={t('tasks.filterAnyRole')}
                    onChange={(next) => selectRole(next as Role | typeof ANY_FILTER)}
                    clearLabel={t('tasks.clearFacet', { facet: t('tasks.facetRole') })}
                  />
                ) : null}
                {canWrite ? (
                  <FilterMenu
                    facet={t('tasks.facetPerson')}
                    icon="account"
                    value={assigneeFilter}
                    choices={personChoices}
                    anyLabel={t('tasks.filterAnyAssignee')}
                    onChange={setAssigneeFilter}
                    clearLabel={t('tasks.clearFacet', { facet: t('tasks.facetPerson') })}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {query.isPending ? (
        <BoardLoading />
      ) : query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : tasks.length === 0 ? (
        <BoardEmpty canCreate={canCreateHere} onCreate={openCreate} />
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
            // A non-empty board a lens narrowed to nothing: a plain line, not the empty state,
            // and it names what did the narrowing. An empty personal tab is the case worth
            // separating — nothing is assigned to you is a fact about the shift, not a filter
            // that came up short, and blaming filters there sends someone hunting for a control
            // that is not on the screen.
            <p className="py-6 text-center text-body text-muted-foreground">
              {term !== ''
                ? t('tasks.searchNoMatches')
                : scope === 'personal' && !clearableLens
                  ? t('tasks.personalEmpty')
                  : t('tasks.lensNoMatches')}
            </p>
          ) : view === 'list' ? (
            <TaskList
              columns={columns}
              onOpen={openEdit}
              onCreate={openCreate}
              onStatusChange={handleStatusMove}
              canWrite={canWrite}
              locationNames={isAdmin ? locationNames : undefined}
            />
          ) : (
            // The status kanban (#214): segmented status tabs over one lane below lg (owner
            // decision 2026-08), a three-lane grid at lg. A writer viewing the shared manual order
            // drags to reorder within a lane or set status across lanes (desktop); an employee
            // drags across lanes only (their status write); the priority lens and an active search
            // render the same lanes without drag. On mobile every card's StatusControl pill is the
            // cross-lane move.
            <StatusBoard
              columns={columns}
              renderCard={renderCard}
              drag={dragMode}
              onReorder={handleReorder}
              onStatusMove={handleStatusMove}
            />
          )}
        </>
      )}

      {/* Mobile Create FAB — the shell reserves the primary create action to the screen (#207);
          the board owns it. Hidden from md, where the content-header's New task takes over.
          Restored 2026-08-12 (owner call, after a stint in the chip row and then the title row).
          The offset clears the tab bar (~4.7rem tall) plus the phone's home indicator with a gap
          rather than sitting flush against it — at the old 4.75rem the two edges touched. */}
      {canCreateHere ? (
        <Button
          aria-label={t('tasks.newTask')}
          onClick={openCreate}
          className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] end-4 z-30 size-[54px] rounded-full p-0 shadow-md md:hidden"
        >
          <Icon name="create" size="lg" />
        </Button>
      ) : null}

      {/* The one create/edit sheet, mounted only while open so its react-hook-form state resets each
          time. Gated to a writer with a resolved principal. */}
      {canWrite && principal && sheet ? (
        <TaskFormDialog
          mode={sheet.mode}
          principal={principal}
          users={users}
          task={sheet.mode === 'edit' ? sheet.task : undefined}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {/* The private-task dialog (owner ask 2026-08-24; create, edit and delete since
          2026-08-25): mounted only while open so its fields reset each time, like the sheet
          above. */}
      {canCreatePersonal && principal && personalEdit ? (
        <PersonalTaskDialog
          principal={principal}
          task={personalEdit.task}
          onClose={() => setPersonalEdit(null)}
        />
      ) : null}
    </section>
  )
}
