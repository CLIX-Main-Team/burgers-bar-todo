import { type TaskPriority, type TaskStatus, isChainAdmin } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import { DEMO_PROJECTS, type DemoProject, completionPercent } from '../projects/project-fixtures.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { BoardError } from '../tasks/board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from '../tasks/board-stream.js'
import { DEMO_WEEK } from './dashboard-fixtures.js'
import {
  type BranchBreakdown,
  type PersonLoad,
  type ShiftMetrics,
  assigneeLoad,
  branchBreakdown,
  priorityMix,
  shiftMetrics,
} from './dashboard-metrics.js'
import { DashboardTable } from './dashboard-table.js'
import { Donut } from './status-donut.js'

// The Dashboard (round 11, 2026-08-23 — a rebuild of the round-10 screen).
//
// It answers one question, the one a shift manager opens their phone at 07:00 to ask: is today
// on track, and where is it not. That is why it is not a business-intelligence page. There is
// no revenue and no month-over-month: this chain runs on shifts and checklists, so the screen
// is built out of the checklist.
//
// What round 11 changed, on the owner's call ("I don't like how our dashboard is designed…
// I want some colours in it so it looks modern"):
//
//   - Colour now carries meaning everywhere it appears. The round-10 screen was four identical
//     white tiles and two grey rank lists; the only colour on it was three status dots. Every
//     tone here is a token this app ALREADY spends on that exact meaning — the status triad on
//     the tiles and the bars, the priority triad on the second ring, destructive red on overdue,
//     the eight person tones on the faces. Nothing decorative was added, and the primary blue is
//     still reserved for the things you click (the v2 rule: gold is a surface, blue is the only
//     thing you press).
//   - A SECOND ring, for priority. The first says where the shift IS, the second says what is
//     left is WORTH — priority.ts draws that distinction and no completion ring can show it. A
//     board can read 70% done and still be carrying every urgent job it opened with.
//   - Branches became three-part bars instead of one completion figure, ordered by who needs a
//     manager rather than by who is winning.
//   - The task table at the foot, filterable and paged, so the screen ends in the detail the
//     numbers above are made of.
//
// It reads the same board query the Tasks screen reads, off the same cache key and the same
// live channel, so the two can never disagree about a number. The read is scoped by the API
// from the principal (ADR-0007), which makes the screen role-shaped for free: an employee sees
// their own tasks, a manager their branch, an admin the chain. The ranking cards are drawn only
// where they can say something — a one-branch manager gets no branch table, an employee no
// roster.
//
// The two invented things on the page — the six days behind today and the project rows — each
// say so on their own card's face.

const STATUS_STROKE: Record<TaskStatus, string> = {
  not_started: 'stroke-status-not-started-dot',
  in_progress: 'stroke-status-in-progress-dot',
  done: 'stroke-status-done-dot',
}

const STATUS_FILL: Record<TaskStatus, string> = STATUS_DOT

const PRIORITY_STROKE: Record<TaskPriority, string> = {
  normal: 'stroke-priority-normal',
  medium: 'stroke-priority-medium',
  high: 'stroke-priority-high',
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
  normal: 'bg-priority-normal',
  medium: 'bg-priority-medium',
  high: 'bg-priority-high',
}

export function DashboardScreen() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { principal } = useSession()

  const query = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  // The same live channel the board subscribes to: a status change made on the board moves the
  // rings behind it without a refetch.
  useBoardStream()

  const isAdmin = principal ? isChainAdmin(principal.role) : false
  const canSeeRoster = principal ? principal.role !== 'employee' : false
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locationNames = new Map(
    (locationsQuery.data ?? []).map((location) => [location.id, location.name]),
  )

  const tasks = query.data?.tasks ?? []
  const now = new Date()
  const metrics = shiftMetrics(tasks, now)
  const branches = isAdmin ? branchBreakdown(tasks, locationNames, now) : []
  const people = canSeeRoster ? assigneeLoad(tasks, now) : []
  const priorities = priorityMix(tasks)

  // The branch table needs at least two branches to be a comparison at all.
  const showBranches = branches.length > 1
  const showRoster = people.length > 0

  const today = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(now)

  return (
    <div className="flex flex-col gap-4.5">
      <div className="min-w-0">
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('dashboard.title')}</h1>
        <p className="mt-0.5 text-label text-muted-foreground">{today}</p>
      </div>

      {query.isError ? (
        <BoardError onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <DashboardLoading />
      ) : (
        <>
          {/* The numbers first: five states of the same board, each wearing the tone that state
              already owns everywhere else in this app. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile
              icon="tasks"
              tone="neutral"
              value={metrics.total}
              label={t('dashboard.statTotal')}
            />
            <Tile
              icon="status-in-progress"
              tone="progress"
              value={metrics.inProgress}
              label={t('dashboard.statInProgress')}
            />
            <Tile
              icon="due-date"
              tone="due"
              value={metrics.dueToday}
              label={t('dashboard.statDueToday')}
            />
            <Tile
              icon="overdue"
              tone="overdue"
              value={metrics.overdue}
              label={t('dashboard.statOverdue')}
            />
            <Tile
              icon="status-done"
              tone="done"
              value={metrics.done}
              label={t('dashboard.statDone')}
            />
          </div>

          {/* The two rings and the week, the three chart-shaped readings of the same board. */}
          <div className="grid gap-3.5 lg:grid-cols-3">
            <StatusCard metrics={metrics} />
            <PriorityCard mix={priorities} open={metrics.open} />
            <WeekCard todayDone={metrics.done} todayTotal={metrics.total} />
          </div>

          {(showBranches || showRoster) && (
            <div className={cn('grid gap-3.5', showBranches && showRoster ? 'lg:grid-cols-2' : '')}>
              {showBranches ? <BranchCard branches={branches} /> : null}
              {showRoster ? <RosterCard people={people} /> : null}
            </div>
          )}

          {canSeeRoster ? <ProjectsCard /> : null}

          <DashboardTable tasks={tasks} branches={locationNames} now={now} />
        </>
      )}
    </div>
  )
}

// The card silhouettes, so the page does not jump when the board read lands.
function DashboardLoading() {
  const t = useTranslations()
  return (
    <div aria-busy="true" aria-label={t('dashboard.loading')} className="flex flex-col gap-4.5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((slot) => (
          <div
            key={slot}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
          >
            <Skeleton className="size-8 flex-none rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="mt-1.5 h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <div
            key={slot}
            className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm"
          >
            <Skeleton className="size-[88px] flex-none rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-3 w-full rounded-[3px]" />
              <Skeleton className="mt-2 h-3 w-3/4 rounded-[3px]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// The KPI tile. `tone` names the STATE, not a colour, so the map below is the one place a state
// picks its ink — and every one of them is the token that state already wears on a card, a lane
// head or a due line. Neutral is deliberate for the total: a count of everything is not a state,
// and spending a hue on it would be the first decorative colour on the page.
const TILE_TONE = {
  neutral: { chip: 'bg-muted', ink: 'text-muted-foreground', value: 'text-foreground' },
  progress: {
    chip: 'bg-status-in-progress-dot/12',
    ink: 'text-status-in-progress-dot',
    value: 'text-foreground',
  },
  due: { chip: 'bg-warning-muted', ink: 'text-warning-muted-foreground', value: 'text-foreground' },
  overdue: {
    chip: 'bg-destructive-muted',
    ink: 'text-destructive-muted-foreground',
    value: 'text-destructive',
  },
  done: {
    chip: 'bg-success-muted',
    ink: 'text-success-muted-foreground',
    value: 'text-foreground',
  },
} as const

function Tile({
  icon,
  tone,
  value,
  label,
}: {
  icon: IconRole
  tone: keyof typeof TILE_TONE
  value: number
  label: string
}) {
  const skin = TILE_TONE[tone]
  // Overdue is the one figure on this screen that asks for something, so it takes the
  // destructive ink — but only when there is actually something to ask about. A zero in red
  // would be an alarm about nothing.
  const alarm = tone === 'overdue' && value > 0

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      {/* The glyph is a second carrier beside the tone, never a swatch on its own: the tile
          still reads correctly in greyscale and to a colourblind reader. */}
      <span className={cn('inline-grid size-8 flex-none place-items-center rounded-md', skin.chip)}>
        <Icon name={icon} size="sm" className={skin.ink} />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'text-heading-md leading-tight font-extrabold tabular-nums',
            alarm ? skin.value : 'text-foreground',
          )}
        >
          {value}
        </p>
        <p className="truncate text-caption text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function CardHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="min-w-0">
      <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
      <p className="mt-0.5 text-caption text-muted-foreground">{note}</p>
    </div>
  )
}

// A ring beside its own legend. Both cards below are this shape, so the two read as a pair of
// answers to one board rather than as two unrelated charts.
function ChartCard({
  title,
  note,
  segments,
  value,
  caption,
  legend,
}: {
  title: string
  note: string
  segments: { id: string; value: number; stroke: string }[]
  value: string
  caption: string
  legend: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <CardHead title={title} note={note} />
      <div className="flex items-center gap-4">
        <Donut size="sm" segments={segments} value={value} caption={caption} />
        {/* The legend is what keeps the colour from being the only carrier (WCAG 1.4.1): every
            slice states its name and its count in words beside its swatch. */}
        <ul className="flex min-w-0 flex-1 flex-col gap-1.5">{legend}</ul>
      </div>
    </section>
  )
}

function LegendRow({ dot, label, count }: { dot: string; label: string; count: number }) {
  return (
    <li className="flex items-center gap-2 text-caption text-muted-foreground">
      <span aria-hidden="true" className={cn('size-[7px] flex-none rounded-full', dot)} />
      <span className="min-w-0 truncate">{label}</span>
      <span className="ms-auto font-bold tabular-nums text-foreground">{count}</span>
    </li>
  )
}

// Ring one: where the shift IS.
function StatusCard({ metrics }: { metrics: ShiftMetrics }) {
  const t = useTranslations()
  const order: TaskStatus[] = ['done', 'in_progress', 'not_started']
  const count: Record<TaskStatus, number> = {
    done: metrics.done,
    in_progress: metrics.inProgress,
    not_started: metrics.notStarted,
  }

  return (
    <ChartCard
      title={t('dashboard.shiftTitle')}
      note={metrics.total === 0 ? t('dashboard.shiftEmpty') : t('dashboard.shiftNote')}
      segments={order.map((status) => ({
        id: status,
        value: count[status],
        stroke: STATUS_STROKE[status],
      }))}
      value={`${metrics.percentDone}%`}
      caption={t('dashboard.donutCaption')}
      legend={order.map((status) => (
        <LegendRow
          key={status}
          dot={STATUS_FILL[status]}
          label={t(taskStatusLabelKey(status))}
          count={count[status]}
        />
      ))}
    />
  )
}

// Ring two: what is LEFT is worth. The centre holds the open count rather than a percentage —
// a "% high priority" would be a share of a number the reader cannot see, while "9 open" is the
// thing the three slices are a breakdown of.
function PriorityCard({
  mix,
  open,
}: {
  mix: { priority: TaskPriority; count: number }[]
  open: number
}) {
  const t = useTranslations()
  return (
    <ChartCard
      title={t('dashboard.priorityTitle')}
      note={t('dashboard.prioritySubtitle')}
      segments={mix.map((slice) => ({
        id: slice.priority,
        value: slice.count,
        stroke: PRIORITY_STROKE[slice.priority],
      }))}
      value={String(open)}
      caption={t('dashboard.priorityCaption')}
      legend={mix.map((slice) => (
        <LegendRow
          key={slice.priority}
          dot={PRIORITY_DOT[slice.priority]}
          label={t(taskPriorityLabelKey(slice.priority))}
          count={slice.count}
        />
      ))}
    />
  )
}

// The week, as columns of tasks finished per day. Today's column is the live count and is marked
// the way the whole app marks "you are here" — a gold rule under it and its weekday in full ink
// — rather than by painting the bar a second colour, which would read as a second category.
function WeekCard({ todayDone, todayTotal }: { todayDone: number; todayTotal: number }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const now = new Date()

  const days = [...DEMO_WEEK, { daysAgo: 0, done: todayDone, total: todayTotal }].map((day) => {
    const date = new Date(now)
    date.setDate(date.getDate() - day.daysAgo)
    return {
      ...day,
      isToday: day.daysAgo === 0,
      label: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
    }
  })

  // Bars are read against the busiest day, not against each day's own total: the question this
  // chart answers is "was today heavy or light", and a per-day scale would flatten every column
  // to the same height and answer nothing.
  const peak = Math.max(...days.map((day) => day.total), 1)

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <CardHead title={t('dashboard.weekTitle')} note={t('dashboard.weekSample')} />

      <div className="mt-3.5 flex items-end gap-1.5">
        {days.map((day) => (
          <div key={day.daysAgo} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            {/* The value rides above every bar, so the chart never needs a hover to be read. */}
            <span
              className={cn(
                'text-caption tabular-nums',
                day.isToday ? 'font-bold text-foreground' : 'text-muted-foreground',
              )}
            >
              {day.done}
            </span>
            <div className="flex h-[72px] w-full items-end border-b border-border">
              {/* Finished work wears the done tone here, the same green the ring's done arc and
                  every done dot wear — the round-10 bar was primary blue, which said "press me"
                  about a chart. */}
              <div
                aria-hidden="true"
                className={cn(
                  'w-full rounded-t-sm',
                  day.isToday ? 'bg-status-done-dot' : 'bg-status-done-dot/45',
                )}
                style={{ height: `${Math.max(Math.round((day.done / peak) * 100), 2)}%` }}
              />
            </div>
            <span
              className={cn(
                'w-full truncate text-center text-caption',
                day.isToday ? 'font-bold text-foreground' : 'text-muted-foreground',
              )}
            >
              {day.label}
            </span>
            {/* The same gold marker the nav rail and the scope tabs use for the current one. */}
            <span
              aria-hidden="true"
              className={cn(
                'h-[2px] w-full rounded-full',
                day.isToday ? 'bg-gold' : 'bg-transparent',
              )}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

// The three-part bar every breakdown row below wears. Segments are laid out in board order —
// done, in progress, not started — and a 2px gap of the card's own surface separates them, so
// two touching tones read as two quantities rather than one blended smear. A zero-width segment
// is dropped rather than drawn as a hairline nobody can measure.
function StackedBar({
  parts,
  total,
  className,
}: {
  parts: { id: string; value: number; fill: string }[]
  total: number
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-[6px] gap-[2px] overflow-hidden rounded-full bg-muted', className)}
    >
      {parts.map((part) =>
        part.value === 0 ? null : (
          <span
            key={part.id}
            className={part.fill}
            style={{ width: `${total === 0 ? 0 : (part.value / total) * 100}%` }}
          />
        ),
      )}
    </span>
  )
}

// The red flag a row grows when it is carrying late work. Never colour alone: a clock glyph and
// the count ride with it.
function OverdueFlag({ count }: { count: number }) {
  const t = useTranslations()
  if (count === 0) return null
  return (
    <span
      className="inline-flex flex-none items-center gap-1 rounded-full bg-destructive-muted px-1.5 py-0.5 text-caption font-semibold text-destructive-muted-foreground"
      title={t('dashboard.overdueCount', { count })}
    >
      <Icon name="overdue" size="sm" className="size-3.5" />
      {count}
    </span>
  )
}

// The chain breakdown, admin and up. Each branch is a three-part bar rather than one completion
// figure: two branches both at 40% done are not in the same shape if one has the rest running
// and the other has not started any of it.
function BranchCard({ branches }: { branches: BranchBreakdown[] }) {
  const t = useTranslations()
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <CardHead title={t('dashboard.branchesTitle')} note={t('dashboard.branchesSubtitle')} />
      <ul className="mt-3.5 flex flex-col gap-3">
        {branches.map((branch) => (
          <li key={branch.locationId} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span dir="auto" className="min-w-0 truncate text-body font-semibold text-foreground">
                {branch.name}
              </span>
              <OverdueFlag count={branch.overdue} />
              <span className="ms-auto flex-none text-caption tabular-nums text-muted-foreground">
                {t('dashboard.ofTotal', { done: branch.done, total: branch.total })}
              </span>
            </div>
            <StackedBar
              total={branch.total}
              parts={[
                { id: 'done', value: branch.done, fill: STATUS_FILL.done },
                { id: 'in_progress', value: branch.inProgress, fill: STATUS_FILL.in_progress },
                { id: 'not_started', value: branch.notStarted, fill: STATUS_FILL.not_started },
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Who is carrying the shift. The bar fills with what each person has FINISHED, while the order
// puts whoever is late first and the heaviest plate next — which is exactly where a manager's
// eye should land.
function RosterCard({ people }: { people: PersonLoad[] }) {
  const t = useTranslations()
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <CardHead title={t('dashboard.rosterTitle')} note={t('dashboard.rosterSubtitle')} />
      <ul className="mt-3.5 flex flex-col gap-3">
        {people.map((person) => (
          <li key={person.userId} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Avatar name={person.name} className="size-6 flex-none" />
              <span dir="auto" className="min-w-0 truncate text-body font-semibold text-foreground">
                {person.name}
              </span>
              <OverdueFlag count={person.overdue} />
              <span className="ms-auto flex-none text-caption tabular-nums text-muted-foreground">
                {t('dashboard.openOf', { open: person.open, total: person.total })}
              </span>
            </div>
            <StackedBar
              total={person.total}
              parts={[
                { id: 'done', value: person.done, fill: STATUS_FILL.done },
                { id: 'open', value: person.open, fill: STATUS_FILL.not_started },
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

// The projects strip. It reads the same fixtures the /projects screen reads — there is no
// projects table, no endpoint and no write path yet (the owner's call was front-end first) — so
// the card carries the same "sample data" line that screen carries rather than looking like a
// surface that lost its data. Delete both the day the backend lands.
function ProjectsCard() {
  const t = useTranslations()
  const active = DEMO_PROJECTS.filter((project) => project.status !== 'done')

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <CardHead title={t('dashboard.projectsTitle')} note={t('projects.sampleData')} />
        <Link
          to="/projects"
          className="ms-auto flex-none text-caption font-semibold text-link underline-offset-4 hover:underline"
        >
          {t('dashboard.allProjects')}
        </Link>
      </div>

      <ul className="mt-3.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}
      </ul>
    </section>
  )
}

function ProjectRow({ project }: { project: DemoProject }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const language = locale === 'he' ? 'he' : 'en'
  const percent = completionPercent(project)

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-lane px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span dir="auto" className="min-w-0 flex-1 text-body font-semibold text-foreground">
          {project.name[language]}
        </span>
        <AvatarStack
          names={project.owners.map((owner) => owner[language])}
          label={t('projects.owners')}
        />
      </div>

      <StackedBar
        total={project.total}
        parts={[
          { id: 'done', value: project.done, fill: STATUS_FILL.done },
          {
            id: 'left',
            value: project.total - project.done,
            fill: STATUS_FILL[project.status === 'not_started' ? 'not_started' : 'in_progress'],
          },
        ]}
      />

      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span dir="auto" className="min-w-0 truncate">
          {project.branch ? project.branch[language] : t('projects.chainWide')}
        </span>
        <span className="ms-auto flex-none tabular-nums">
          {t('dashboard.percentDone', { percent })}
        </span>
      </div>
    </li>
  )
}
