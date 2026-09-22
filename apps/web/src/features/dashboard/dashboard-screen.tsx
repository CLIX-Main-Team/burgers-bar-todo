import { departmentLabel } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { hasCapability, viewScopeOf } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { CARD_SURFACE } from '../../components/ui/surfaces.js'
import { useLocale } from '../../i18n/locale.js'
import { tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { departmentIconName } from '../departments/department-icon.js'
import { useDepartments } from '../departments/use-departments.js'
import { branchesOf, headOfficeOf, useLocations } from '../locations/use-locations.js'
import { useProjects } from '../projects/project-queries.js'
import { BoardError } from '../tasks/board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from '../tasks/board-stream.js'
import { isOverdue } from '../tasks/due-date.js'
import { FilterMenu } from '../tasks/filter-menu.js'
import { useAllSubjects } from '../tasks/subject-queries.js'
import { ANY_FILTER, sharedTasks } from '../tasks/task-filters.js'
import { ActivityCard } from './activity-card.js'
import { AttentionCard } from './attention-card.js'
import { ChainCard, type ChainRow } from './chain-card.js'
import { ENTER } from './dashboard-card.js'
import {
  attention,
  branchHealth,
  departmentRows,
  overviewMetrics,
  placeRows,
  priorityMix,
  workload,
} from './dashboard-metrics.js'
import { HeroCard } from './hero-card.js'
import { OverviewCard, TILES } from './overview-card.js'
import { ProjectsCard } from './projects-card.js'
import { WorkloadCard } from './workload-card.js'

// The Dashboard, round 3 (2026-09-22; round 10 built it, round 11 rebuilt it, round 12 animated
// it).
//
// It answers one question, the one somebody opens the app to ask first thing: how is the work
// going, and where do I need to step in. The owner asked for the layout of his coworkers'
// dashboards (a hero figure, an overview of tiles, activity over time, each person's load, the
// chain at a glance, a short list to chase) and left the choice of data to us; design.md in
// docs/features/dashboard records what each card shows and why.
//
// It reads the same board query as the Tasks screen, off the same cache key and the same live
// channel, so the two can never disagree about a number, and a status changed on the board moves
// the figures here without a refetch. The API scopes that read from the principal (ADR-0007), so
// the page is role-shaped for free: an employee sees their own work, a branch manager their
// branch, the owner the chain. The cards that compare people or places are drawn only where
// there is more than one to compare.
//
// The Branch and Department filters scope every card below them. They narrow the one task list
// before any figure is counted, so every number on the page always agrees with every other.

// The entrance, as one score (round 12's rule): every block rises the same distance over the same
// duration and only its delay differs, so the page assembles top to bottom as one movement. The
// tree mounts when the skeleton gives way, so it plays once and never on a filter change.
const SCORE = {
  header: 0,
  hero: 60,
  overview: 100,
  /** Between one overview tile and the next: fast enough to read as one sweep across the row. */
  tileStep: 45,
  activity: 220,
  workload: 260,
  chain: 320,
  attention: 360,
  projects: 420,
}

export function DashboardScreen() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { principal } = useSession()

  const board = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  useBoardStream()

  // GET /locations answers to the Locations page (or its manage switch) and refuses everyone
  // else, so the names are asked for only where they will be given.
  const canReadLocations = principal
    ? hasCapability(principal, 'page.locations') || hasCapability(principal, 'locations.manage')
    : false
  const canSeeProjects = principal ? hasCapability(principal, 'page.projects') : false
  // A viewer who sees only their own assignments has no team to weigh.
  const seesTeam = principal ? viewScopeOf(principal, 'dashboard.view') !== 'assigned' : false

  const locationsQuery = useLocations({ enabled: canReadLocations })
  const departmentsQuery = useDepartments()
  const all = sharedTasks(board.data?.tasks ?? [])
  // A task's department is its subject's, so the subjects are read only once there is work filed
  // under one; the list read is open to everyone who can open this page.
  const subjectsQuery = useAllSubjects({ enabled: all.some((task) => task.subjectId !== null) })
  const projectsQuery = useProjects({ enabled: canSeeProjects })

  const [branchId, setBranchId] = useState<string>(ANY_FILTER)
  const [departmentId, setDepartmentId] = useState<string>(ANY_FILTER)

  const locations = locationsQuery.data ?? []
  const locationNames = new Map(locations.map((location) => [location.id, location.name]))
  const branchNumbers = new Map(locations.map((location) => [location.id, location.number]))
  const branchIds = branchesOf(locations).map((location) => location.id)
  const headOfficeId = headOfficeOf(locations)?.id
  const subjects = subjectsQuery.data ?? []
  const subjectDepartment = new Map(subjects.map((subject) => [subject.id, subject.departmentId]))
  const subjectNames = new Map(subjects.map((subject) => [subject.id, subject.name]))
  const departments = (departmentsQuery.data ?? []).map((department) => ({
    id: department.id,
    name: departmentLabel(department, locale),
    slug: department.slug,
  }))
  const departmentOf = (subjectId: string | null) =>
    subjectId ? subjectDepartment.get(subjectId) : undefined

  // What the filters offer follows how far the viewer sees, not what the board holds today. The
  // first cut offered only the places and departments holding some work, and on a quiet board
  // both chips vanished and read as missing (owner, 2026-09-22). So a chain-wide horizon is
  // offered every place and every department, busy or not, and the controls stay put from one
  // day to the next; a narrower horizon is offered what its own work touches. A chip with a
  // single choice is still not drawn, so a one-branch manager gets no Branch chip.
  const offersEveryPlace = principal ? viewScopeOf(principal, 'dashboard.view') === 'chain' : false
  const offersEveryDepartment = principal
    ? viewScopeOf(principal, 'tasks.departments') === 'chain'
    : false
  const placesInPlay = offersEveryPlace
    ? new Set(locations.map((location) => location.id))
    : new Set(all.map((task) => task.locationId))
  const namedPlaces = [...placesInPlay]
    .flatMap((id) => {
      const name = locationNames.get(id)
      return name ? [{ value: id, label: name }] : []
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale))
  const departmentsInPlay = new Set(all.map((task) => departmentOf(task.subjectId)))
  const namedDepartments = offersEveryDepartment
    ? departments
    : departments.filter((department) => departmentsInPlay.has(department.id))
  const showBranchFilter = namedPlaces.length > 1
  const showDepartmentFilter = namedDepartments.length > 1

  const tasks = all.filter(
    (task) =>
      (branchId === ANY_FILTER || task.locationId === branchId) &&
      (departmentId === ANY_FILTER || departmentOf(task.subjectId) === departmentId),
  )

  const now = new Date()
  const overview = overviewMetrics(tasks, now)
  const people = workload(tasks, now)
  const lists = attention(tasks, now)
  const priorities = priorityMix(tasks)

  const runningProjects = (projectsQuery.data?.projects ?? []).filter(
    (project) => project.status !== 'done',
  )
  const projectCounts = canSeeProjects
    ? {
        running: runningProjects.length,
        late: runningProjects.filter(
          (project) =>
            project.targetDate !== null && isOverdue(project.targetDate, project.status, now),
        ).length,
      }
    : null

  // The chain card compares places, so it needs their names and more than one of them in view.
  const showChain =
    locationNames.size > 0 &&
    branchId === ANY_FILTER &&
    new Set(tasks.map((task) => task.locationId)).size > 1
  const chainBranches: ChainRow[] = placeRows(tasks, locationNames, now).map((row) => {
    const number = branchNumbers.get(row.id)
    return {
      ...row,
      badge:
        row.id === headOfficeId || number === null || number === undefined
          ? { kind: 'icon', icon: 'department-management' }
          : { kind: 'number', value: number },
    }
  })
  const chainDepartments: ChainRow[] | null =
    namedDepartments.length > 1
      ? departmentRows(tasks, subjectDepartment, departments, now).map((row) => ({
          ...row,
          badge: {
            kind: 'icon',
            icon: departmentIconName(
              departments.find((department) => department.id === row.id)?.slug ?? '',
            ),
          },
        }))
      : null

  const today = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)

  return (
    <div className="flex flex-col gap-5">
      <div
        className={cn('flex flex-wrap items-end gap-x-6 gap-y-3', ENTER)}
        style={{ animationDelay: `${SCORE.header}ms` }}
      >
        <div className="min-w-0">
          <h1 className="text-heading-lg font-extrabold text-foreground">{t('dashboard.title')}</h1>
          <p className="mt-0.5 text-label text-muted-foreground">{today}</p>
        </div>
        {showBranchFilter || showDepartmentFilter ? (
          <div className="ms-auto flex flex-wrap gap-2">
            {showBranchFilter ? (
              <FilterMenu
                facet={t('tasks.facetBranch')}
                icon="location"
                value={branchId}
                onChange={setBranchId}
                anyLabel={t('tasks.filterAnyBranch')}
                clearLabel={t('tasks.clearFacet', { facet: t('tasks.facetBranch') })}
                choices={namedPlaces}
              />
            ) : null}
            {showDepartmentFilter ? (
              <FilterMenu
                facet={t('dashboard.facetDepartment')}
                icon="change-department"
                value={departmentId}
                onChange={setDepartmentId}
                anyLabel={t('dashboard.filterAnyDepartment')}
                clearLabel={t('tasks.clearFacet', { facet: t('dashboard.facetDepartment') })}
                choices={namedDepartments.map((department) => ({
                  value: department.id,
                  label: department.name,
                  lead: <Icon name={departmentIconName(department.slug)} size="sm" />,
                }))}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {board.isError ? (
        <BoardError onRetry={() => board.refetch()} />
      ) : board.isPending ? (
        <DashboardLoading />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* The hero shares the overview's row only from 1440px, where the overview's two
              thirds still hold all five tiles in one row. Narrower, the hero would sit beside
              two rows of tiles and stretch to their height with nothing in it, so it takes the
              full width above them instead. Both steps are arbitrary widths, so the property
              never mixes a named breakpoint with an arbitrary one. */}
          <HeroCard
            open={overview.open}
            overdue={overview.overdue}
            dueToday={overview.dueToday}
            delay={SCORE.hero}
            className="min-[768px]:col-span-12 min-[1440px]:col-span-4"
          />
          <OverviewCard
            overview={overview}
            projects={projectCounts}
            delay={SCORE.overview}
            tileStep={SCORE.tileStep}
            className="min-[768px]:col-span-12 min-[1440px]:col-span-8"
          />
          <ActivityCard
            tasks={tasks}
            now={now}
            delay={SCORE.activity}
            className={seesTeam ? 'md:col-span-12 lg:col-span-6' : 'md:col-span-12'}
          />
          {seesTeam ? (
            <WorkloadCard
              people={people}
              delay={SCORE.workload}
              className="md:col-span-12 lg:col-span-6"
            />
          ) : null}
          {showChain ? (
            <ChainCard
              health={branchIds.length > 0 ? branchHealth(tasks, branchIds, now) : null}
              priorities={priorities}
              openTotal={overview.open}
              branches={chainBranches}
              branchCount={branchIds.length}
              departments={chainDepartments}
              linkToLocations={principal ? hasCapability(principal, 'page.locations') : false}
              delay={SCORE.chain}
              className="md:col-span-12 lg:col-span-6"
            />
          ) : null}
          <AttentionCard
            attention={lists}
            placeNames={locationNames}
            subjectNames={subjectNames}
            now={now}
            delay={SCORE.attention}
            className={showChain ? 'md:col-span-12 lg:col-span-6' : 'md:col-span-12'}
          />
          {canSeeProjects ? (
            <ProjectsCard
              now={now}
              canWrite={principal ? hasCapability(principal, 'projects.manage') : false}
              delay={SCORE.projects}
              className="md:col-span-12"
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

// The card silhouettes, shaped like the grid they give way to, so nothing jumps when the board
// read lands.
function DashboardLoading() {
  const t = useTranslations()
  return (
    <div
      aria-busy="true"
      aria-label={t('dashboard.loading')}
      className="grid grid-cols-1 gap-4 md:grid-cols-12"
    >
      <div
        className={cn(
          CARD_SURFACE,
          'flex min-h-[13rem] flex-col gap-4 p-6 min-[768px]:col-span-12 min-[1440px]:col-span-4',
        )}
      >
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-14 w-24" />
        <Skeleton className="h-7 w-44 rounded-full" />
      </div>
      <div className={cn(CARD_SURFACE, 'p-6 min-[768px]:col-span-12 min-[1440px]:col-span-8')}>
        <Skeleton className="h-4 w-24" />
        <div className="@container mt-4">
          <div className={cn('grid grid-cols-2 gap-3', TILES.fiveAcross)}>
            {[0, 1, 2, 3, 4].map((slot) => (
              <Skeleton key={slot} className="h-32 rounded-[0.875rem]" />
            ))}
          </div>
        </div>
      </div>
      {[0, 1].map((slot) => (
        <div key={slot} className={cn(CARD_SURFACE, 'p-6 md:col-span-12 lg:col-span-6')}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-48" />
          <Skeleton className="mt-6 h-56 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}
