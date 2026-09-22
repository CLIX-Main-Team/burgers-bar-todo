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
import { hasCapability, viewScopeOf } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { PillGroup } from '../../components/ui/pill-group.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from '../people/user-list.js'
import { groupByStatus } from './board-columns.js'
import { BoardEmpty, BoardError, BoardLoading } from './board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from './board-stream.js'
import { BoardTaskCard } from './board-task-card.js'
import { PersonalPill, TaskNav } from './department-ledger.js'
import { DepartmentSubjects, useChosenDepartment } from './department-subjects.js'
import { dueDay, isOverdue } from './due-date.js'
import { FilterAvatar, type FilterChoice, FilterMenu } from './filter-menu.js'
import { peopleForFacets, personSurvives, rolesForBranch } from './filter-options.js'
import { PersonalTaskDialog } from './personal-task-dialog.js'
import { applyReorder } from './reorder.js'
import { type BoardDragMode, StatusBoard } from './status-board.js'
import { StatusTaskCard } from './status-task-card.js'
import { SubjectHeader, SubjectNotFound } from './subject-header.js'
import { useAllSubjects, useSubject } from './subject-queries.js'
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
import { TaskViewDialog } from './task-view-dialog.js'

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
// The board's arrival (round 15, 2026-08-31), in the same shape round 12 gave the dashboard: the
// page assembles top-down in the order a reader takes it in — what this page is, then the controls
// that narrow it, then the work itself. The cards' own stagger is the `bb-stagger` container on
// each lane, so nothing here has to know how many there are.
const SCORE = {
  header: 0,
  lenses: 60,
  board: 140,
}

// The shared board has three levels since 2026-09-20 (owner ask): a department and its subject
// cards, then one subject's board. The screen is one component for all of them because the
// board machinery (the read, the live channel, the lenses, the sheet) is the same underneath;
// `subjectId`, from the `/tasks/subjects/:id` route, is what puts it on the third level.
export function TasksScreen({ subjectId }: { subjectId?: string } = {}) {
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
  const [scopeTab, setScope] = useState<TaskScope>('all')
  // A subject's URL is shared-board territory whatever tab was last pressed.
  const scope: TaskScope = subjectId ? 'all' : scopeTab
  // Which of the three levels is showing: a subject's board, the department and its cards, or
  // the private board. The cards level draws its own body and reads none of the lenses below.
  const level: 'subject' | 'departments' | 'personal' = subjectId
    ? 'subject'
    : scope === 'all'
      ? 'departments'
      : 'personal'
  // The subject under the third level, read on its own so a pasted link resolves without the
  // cards having been visited; a 404 is the not-found state the projects detail also draws.
  const subjectQuery = useSubject(subjectId ?? '')
  const subject = subjectId ? subjectQuery.data : undefined
  const [view, setView] = useState<TaskView>('board')
  const [branchFilter, setBranchFilter] = useState(ANY_FILTER)
  const [assigneeFilter, setAssigneeFilter] = useState(ANY_FILTER)
  const [roleFilter, setRoleFilter] = useState<Role | typeof ANY_FILTER>(ANY_FILTER)
  const [sheet, setSheet] = useState<SheetState>(null)
  // The task a non-writer opened to read (task-view-dialog.tsx).
  const [viewing, setViewing] = useState<Task | null>(null)
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
  // Subjects are shaped by whoever holds tasks.manageSubjects (the super admin by default), and
  // the cards level draws chips only for a chain horizon on tasks.departments; a department-held
  // viewer is already in theirs (2026-09-20).
  const canManageSubjects = principal ? hasCapability(principal, 'tasks.manageSubjects') : false
  const chainWide = principal ? viewScopeOf(principal, 'tasks.departments') === 'chain' : false
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
    subjectId: subjectId ?? ANY_FILTER,
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
  // The strip's counts (Tasks redesign 2026-09-22): open work, the same measure on every pill.
  // Private tasks from the board read; a department's from the subjects read, so the number on
  // its pill agrees with the tiles it leads to.
  const personalOpen = tasks.filter((task) => task.personal && task.status !== 'done').length
  // The private list's pill, for anyone who may keep one or already has some.
  const showPersonal = canCreatePersonal || tasks.some((task) => task.personal)
  const chosenDepartment = useChosenDepartment({
    chainWide,
    ownDepartmentId: principal?.departmentId ?? null,
    syncUrl: level === 'departments',
  })
  const allSubjects = useAllSubjects({ enabled: level !== 'subject' }).data ?? []
  const openByDepartment = new Map<string, number>()
  for (const each of allSubjects) {
    openByDepartment.set(
      each.departmentId,
      (openByDepartment.get(each.departmentId) ?? 0) + each.openCount,
    )
  }
  // The rows this level's board is made of, before the viewer's own lenses: the private board,
  // or the open subject's share of the shared one. An empty list here is the empty state; a
  // non-empty one a lens narrowed to nothing is the "no matches" line.
  const levelTasks =
    level === 'personal'
      ? tasks.filter((task) => task.personal)
      : tasks.filter((task) => !task.personal && task.subjectId === subjectId)
  const levelOpen = levelTasks.filter((task) => task.status !== 'done').length
  const now = new Date()

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
      lead: <FilterAvatar name={user.displayName} tone={user.avatarTone} />,
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
  const canCreateHere = level === 'personal' ? canCreatePersonal : canWrite
  const openCreate = () => {
    if (level === 'personal') {
      if (canCreatePersonal) setPersonalEdit({})
    } else if (canWrite) {
      setSheet({ mode: 'create' })
    }
  }
  // A private task always opens its own editor, whoever is looking — and the person looking is
  // always its writer, since nobody else can see it. The board sheet would offer an assignee
  // picker and a branch (owner's report, 2026-08-25: "it shouldnt be assignable to anybody but
  // myself"), which is a choice this task does not have and the API refuses outright.
  // A reader who may not edit (an employee, a role the owner has not switched on) opens the
  // same task as a read-only sheet instead (owner ask 2026-09-22).
  const openEdit = (task: Task) =>
    task.personal
      ? setPersonalEdit({ task })
      : canWrite
        ? setSheet({ mode: 'edit', task })
        : setViewing(task)

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
      <StatusTaskCard task={task} grip={grip} onOpen={openEdit} />
    )

  // The search field, drawn in the header on the two top levels and in the board's toolbar on a
  // subject's page: one state behind all of them. The Dashboard's rounded field, since the page
  // now shares its toolbar grammar.
  const searchField = (className: string) => (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
        <Icon name="search" size="sm" />
      </span>
      <Input
        type="search"
        aria-label={t('tasks.searchPlaceholder')}
        placeholder={t('tasks.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-9 w-full rounded-full ps-9 text-label md:text-label"
      />
    </div>
  )

  // The priority lens: an icon button that turns solid blue while it is on, the one mark every
  // chosen thing carries (the accent wash it used to wear measured 1.28:1 against the card, and
  // an icon-only button has no label to carry the state instead).
  const sortToggle =
    level !== 'departments' && levelTasks.length > 0 ? (
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={sortByPriority}
        aria-label={sortByPriority ? t('tasks.manualOrder') : t('tasks.sortByPriority')}
        className={cn(
          'size-9 flex-none rounded-full border border-border-strong bg-card shadow-sm',
          sortByPriority
            ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
            : 'text-muted-foreground',
        )}
        onClick={() => setSortByPriority((on) => !on)}
      >
        <Icon name="sort-priority" />
      </Button>
    ) : null

  const newTaskButton = canCreateHere ? (
    <Button onClick={openCreate} className="flex-none">
      <Icon name="create" size="sm" />
      {t('tasks.newTask')}
    </Button>
  ) : null

  return (
    // The mobile bottom padding is the FAB's landing space: it floats over this scroll region, so
    // without it the last card's overflow menu sits under the button at the end of a lane.
    <section data-fills-width className="flex flex-col gap-5 pb-20 md:pb-0">
      {/* The head (Tasks redesign 2026-09-22, the Dashboard's header grammar): on the two top
          levels the page's name and today's date at the inline start, the search and New task at
          the inline end, and under them the one strip that says which tasks are showing (your
          own, or a department's). A subject's page opens on its own card instead, the way back
          to its department above it. */}
      {level === 'subject' && subject ? (
        <div className="motion-safe:animate-rise">
          <SubjectHeader
            subject={subject}
            open={levelOpen}
            done={levelTasks.length - levelOpen}
            overdue={levelTasks.filter((task) => isOverdue(task.dueDate, task.status, now)).length}
            dueToday={
              levelTasks.filter(
                (task) =>
                  task.status !== 'done' &&
                  task.dueDate !== null &&
                  dueDay(task.dueDate, now) === 'today',
              ).length
            }
            delay={SCORE.header}
            action={newTaskButton ? <span className="hidden md:flex">{newTaskButton}</span> : null}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 motion-safe:animate-rise">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="text-heading-lg font-extrabold text-foreground">{t('tasks.title')}</h1>
              {subtitle ? (
                <p className="mt-0.5 text-label text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
            <div className="hidden items-center gap-2.5 md:flex">
              {canWrite ? searchField('w-[15rem]') : null}
              {showPersonal ? (
                <PersonalPill
                  open={personalOpen}
                  active={level === 'personal'}
                  onClick={() => selectScope('personal')}
                />
              ) : null}
              {newTaskButton}
            </div>
          </div>
          {/* The phone's search, full width under the title. */}
          {canWrite ? searchField('w-full md:hidden') : null}
          {level !== 'subject' ? (
            <TaskNav
              personal={showPersonal ? { open: personalOpen, active: level === 'personal' } : null}
              departments={chosenDepartment.pills}
              chosenId={chosenDepartment.chosen?.id ?? null}
              openByDepartment={openByDepartment}
              onSelectPersonal={() => selectScope('personal')}
              onSelectDepartment={(department) => {
                selectScope('all')
                chosenDepartment.select(department)
              }}
            />
          ) : null}
        </div>
      )}

      {/* The board's toolbar, one row over the lanes: the search on a subject's page, the view
          switch and the count at the inline start, then at the inline end the filters, the
          priority lens. On a phone it keeps the search and the sort; the view switch and the
          filters are a desktop's tools. */}
      {level !== 'departments' && levelTasks.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2.5 motion-safe:animate-rise"
          style={delayStyle(SCORE.lenses)}
        >
          {level === 'subject' && canWrite ? searchField('w-full md:w-[13.5rem]') : null}
          <PillGroup
            label={t('tasks.viewSwitch')}
            value={view}
            onChange={setView}
            className="hidden md:flex"
            options={[
              { value: 'board', label: t('tasks.viewBoard'), icon: 'manage-locations' },
              { value: 'list', label: t('tasks.viewList'), icon: 'tasks' },
            ]}
          />
          <p className="text-caption tabular-nums whitespace-nowrap text-muted-foreground">
            {t('tasks.resultCount', { count: visibleTasks.length })}
          </p>
          {clearableLens ? (
            <Button variant="ghost" className="h-8 px-2 text-caption" onClick={clearLenses}>
              {t('tasks.clearFilters')}
            </Button>
          ) : null}

          <div className="ms-auto flex items-center gap-2">
            {/* The three facets, on the shared board only: private tasks are already yours, so
                there is nothing to narrow them by, and a role that holds none of them (an
                employee) gets none rather than an empty group (owner call 2026-08-25). */}
            {scope === 'all' && showFacets ? (
              <div className="hidden flex-wrap items-center gap-2 md:flex">
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
                    it and shove the person filter sideways. */}
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
            {sortToggle}
          </div>
        </div>
      ) : null}

      {level === 'departments' ? (
        // The departments level (2026-09-20): its own reads, its own states, none of the lenses.
        <div className="motion-safe:animate-rise" style={delayStyle(SCORE.lenses)}>
          <DepartmentSubjects
            chosen={chosenDepartment.chosen}
            ownLocationId={principal?.locationId ?? null}
            ownLocationName={principal?.locationName ?? null}
            canManage={canManageSubjects}
            term={term}
            branchFilterable={isAdmin}
            headOfficeName={
              locationsQuery.data?.find((location) => location.kind === 'headquarters')?.name ??
              null
            }
            branches={
              isAdmin && locationsQuery.data
                ? [
                    ...locationsQuery.data.filter((location) => location.kind === 'headquarters'),
                    ...locationsQuery.data.filter((location) => location.kind === 'branch'),
                  ]
                : null
            }
          />
        </div>
      ) : level === 'subject' && subjectQuery.isError ? (
        <SubjectNotFound />
      ) : query.isPending || (level === 'subject' && subjectQuery.isPending) ? (
        <BoardLoading />
      ) : query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : levelTasks.length === 0 ? (
        <BoardEmpty
          canCreate={canCreateHere}
          onCreate={openCreate}
          inSubject={level === 'subject'}
          inPersonal={level === 'personal'}
        />
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
                : level === 'personal' && !clearableLens
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
          className="fixed bottom-[calc(5.5rem+var(--bb-safe-bottom))] end-4 z-30 size-[54px] rounded-full p-0 shadow-md md:hidden"
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
          subjectId={subjectId}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {/* The read-only sheet for a reader who may not edit. The board list feeds it, so a
          status change or a tick it makes shows in it on the next read like anywhere else. */}
      {!canWrite && viewing ? (
        <TaskViewDialog
          task={visibleTasks.find((task) => task.id === viewing.id) ?? viewing}
          locationName={
            isAdmin && viewing.locationId ? locationNames.get(viewing.locationId) : undefined
          }
          onClose={() => setViewing(null)}
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
