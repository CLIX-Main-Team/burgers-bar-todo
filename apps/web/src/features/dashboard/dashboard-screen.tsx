import { type Task, type TaskStatus, isChainAdmin } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Avatar } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { BoardError } from '../tasks/board-states.js'
import { TASKS_QUERY_KEY, useBoardStream } from '../tasks/board-stream.js'
import { DEMO_WEEK } from './dashboard-fixtures.js'
import {
  type BranchProgress,
  type PersonLoad,
  type ShiftMetrics,
  assigneeLoad,
  branchProgress,
  shiftMetrics,
} from './dashboard-metrics.js'
import { StatusDonut } from './status-donut.js'

// The Dashboard (round 10, 2026-08-21) — the screen the app opens on.
//
// It answers one question, the one a shift manager opens their phone at 07:00 to ask: is today
// on track, and where is it not. That is why it is not a business-intelligence page. There is
// no revenue and no month-over-month: this chain runs on shifts and checklists, so the screen
// is built out of the checklist.
//
// It reads the same board query the Tasks screen reads, off the same cache key and the same
// live channel, so the two can never disagree about a number. The read is scoped by the API
// from the principal (ADR-0007), which makes the screen role-shaped for free: an employee sees
// their own tasks, a manager their branch, an admin the chain. The two ranking cards are drawn
// only where they can say something — a one-branch manager gets no branch league table, and an
// employee gets no roster.
//
// The one invented thing on the page is the six days behind today (dashboard-fixtures.ts), and
// the card that draws them says so on its own face.
export function DashboardScreen() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { principal } = useSession()

  const query = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  // The same live channel the board subscribes to: a status change made on the board moves the
  // ring behind it without a refetch.
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
  const branches = isAdmin ? branchProgress(tasks, locationNames) : []
  const people = canSeeRoster ? assigneeLoad(tasks) : []

  // The branch league table needs at least two branches to be a comparison at all.
  const showBranches = branches.length > 1
  const lowerCards = 1 + (showBranches ? 1 : 0) + (people.length > 0 ? 1 : 0)

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
          <ShiftCard tasks={tasks} metrics={metrics} />

          <div className="flex flex-wrap gap-3">
            <Tile value={String(metrics.total)} label={t('dashboard.statTotal')} />
            <Tile value={String(metrics.open)} label={t('dashboard.statOpen')} />
            <Tile value={String(metrics.dueToday)} label={t('dashboard.statDueToday')} />
            <Tile
              value={String(metrics.overdue)}
              label={t('dashboard.statOverdue')}
              // Colour is never the only signal: a real overdue count also grows a glyph.
              alert={metrics.overdue > 0}
            />
          </div>

          {/* One column per card the viewer's role actually earns — three for an admin, two
              for a manager, one for an employee — so the row always divides evenly and no
              card is left spanning the page with its content bunched in one half. */}
          <div
            className={cn(
              'grid gap-3.5',
              lowerCards === 3 ? 'lg:grid-cols-3' : lowerCards === 2 ? 'lg:grid-cols-2' : '',
            )}
          >
            <WeekCard todayDone={metrics.done} todayTotal={metrics.total} />
            {showBranches ? <BranchCard branches={branches} /> : null}
            {people.length > 0 ? <RosterCard people={people} /> : null}
          </div>
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
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm sm:flex-row sm:items-center">
        <Skeleton className="size-[108px] flex-none rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full rounded-[3px]" />
          <Skeleton className="h-3 w-52" />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {[0, 1, 2, 3].map((slot) => (
          <div
            key={slot}
            className="min-w-[7.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]"
          >
            <Skeleton className="h-6 w-12" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

// The hero. Two readings of the same shift, side by side, doing different jobs.
//
// The RING answers "how are we doing" in one glance and is what a dashboard is expected to open
// with. THE STRIP is the part that could not be bought off a shelf: one cell per task, in board
// order, coloured by status. An opening shift is a SEQUENCE — the grill has to be lit before the
// line can be prepped — so where the gaps fall is information, not decoration. The strip shows a
// manager that the two unstarted jobs are the last two (fine, the shift is ahead) or the first
// two (stop and go look). No percentage can tell those apart.
//
// Both speak the app's own vocabulary rather than a chart library's: the arcs and the cells wear
// the identical STATUS_DOT colours the lane heads, the status tabs and every card's status chip
// wear, so neither needs learning. The legend states the split in words, which is what keeps the
// colour from being the only carrier (WCAG 1.4.1).
function ShiftCard({ tasks, metrics }: { tasks: Task[]; metrics: ShiftMetrics }) {
  const t = useTranslations()

  const segments = [
    { status: 'done' as const, value: metrics.done },
    { status: 'in_progress' as const, value: metrics.inProgress },
    { status: 'not_started' as const, value: metrics.notStarted },
  ]

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm sm:flex-row sm:items-center sm:gap-5">
      {/* Centred where the card stacks, so a phone does not leave a hole beside the ring. */}
      <StatusDonut
        className="self-center"
        segments={segments}
        percent={metrics.percentDone}
        caption={t('dashboard.donutCaption')}
      />

      <div className="min-w-0 flex-1">
        {/* The ring states the share and the legend states the counts, so a third "2 of 10
            done" line here would be the same sentence a third time. */}
        <h2 className="text-heading-sm font-bold text-foreground">{t('dashboard.shiftTitle')}</h2>

        {metrics.total === 0 ? (
          <p className="mt-2.5 text-body text-muted-foreground">{t('dashboard.shiftEmpty')}</p>
        ) : (
          <>
            {/* An ordered list, because the order is the point. Each cell names its own task
                and status to assistive tech; the list is named once, so a screen reader
                announces "shift progress" rather than twelve anonymous items. */}
            <ol aria-label={t('dashboard.stripLabel')} className="mt-3.5 flex flex-wrap gap-[3px]">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  // The native tooltip is the pointer's way in, the aria-label is everyone
                  // else's. Both say the same sentence.
                  title={`${task.title} · ${t(taskStatusLabelKey(task.status))}`}
                  aria-label={`${task.title}, ${t(taskStatusLabelKey(task.status))}`}
                  // Full strength, no tint: a status wears one colour on this card, so the
                  // ring's arc and the strip's cell for the same task are the same swatch.
                  className={cn('h-3 min-w-[10px] flex-1 rounded-[3px]', STATUS_DOT[task.status])}
                />
              ))}
            </ol>

            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <LegendRow status="done" count={metrics.done} />
              <LegendRow status="in_progress" count={metrics.inProgress} />
              <LegendRow status="not_started" count={metrics.notStarted} />
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

function LegendRow({ status, count }: { status: TaskStatus; count: number }) {
  const t = useTranslations()
  return (
    <li className="flex items-center gap-1.5 text-caption text-muted-foreground">
      <span aria-hidden="true" className={cn('size-[7px] rounded-full', STATUS_DOT[status])} />
      <span className="font-semibold tabular-nums text-foreground">{count}</span>
      {t(taskStatusLabelKey(status))}
    </li>
  )
}

// The summary tile, drawn to the Locations screen's own StatTile dimensions so the two pages
// read as one app. `alert` is the single deviation: a real overdue count is the one number on
// this screen that asks for something, so it takes the destructive ink and grows a clock.
function Tile({ value, label, alert }: { value: string; label: string; alert?: boolean }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]">
      <p
        className={cn(
          'flex items-center gap-1.5 text-display leading-tight font-bold tabular-nums',
          alert ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
        {alert ? <Icon name="overdue" size="sm" className="size-4.5" /> : null}
      </p>
      <p className="mt-px text-caption text-muted-foreground">{label}</p>
    </div>
  )
}

function CardHead({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
      <p className="mt-0.5 text-caption text-muted-foreground">{note}</p>
    </div>
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

      <div className="mt-4 flex items-end gap-1.5">
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
            {/* No capacity track behind the bar: it drew a second grey block nothing had
                labelled, and the question here is only how many were finished. The bars sit
                on the row's own baseline instead. */}
            <div className="flex h-[72px] w-full items-end border-b border-border">
              <div
                aria-hidden="true"
                className="w-full rounded-t-sm bg-primary"
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

// A ranked row: a name, a bar, and its own numbers. The bar makes the ranking scannable and the
// numbers make it exact, which is the trade a bar chart alone always loses.
function RankRow({
  label,
  fill,
  value,
  lead,
}: {
  label: string
  /** 0–100. */
  fill: number
  value: string
  lead?: React.ReactNode
}) {
  return (
    // The bar is capped rather than fluid: on a card that spans the whole page a
    // proportional column stretched to eight hundred pixels and stopped reading as a
    // measurement. Extra width becomes quiet space at the row's end.
    <li className="grid grid-cols-[minmax(5rem,11rem)_minmax(3rem,20rem)_auto] items-center gap-3">
      <span className="flex min-w-0 items-center gap-2">
        {lead}
        <span dir="auto" className="truncate text-body font-semibold text-foreground">
          {label}
        </span>
      </span>
      <span aria-hidden="true" className="h-[5px] overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
      </span>
      <span className="whitespace-nowrap text-caption tabular-nums text-muted-foreground">
        {value}
      </span>
    </li>
  )
}

// The chain ranking, admin and up. Sorted by completion, because the ranking is the insight.
function BranchCard({ branches }: { branches: BranchProgress[] }) {
  const t = useTranslations()
  return (
    <section className="rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <CardHead title={t('dashboard.branchesTitle')} note={t('dashboard.branchesSubtitle')} />
      <ul className="mt-4 flex flex-col gap-2.5">
        {branches.map((branch) => (
          <RankRow
            key={branch.locationId}
            label={branch.name}
            fill={branch.percent}
            value={t('dashboard.ofTotal', { done: branch.done, total: branch.total })}
          />
        ))}
      </ul>
    </section>
  )
}

// Who is carrying the shift. The bar fills with what each person has FINISHED, while the ranking
// is by what they have left — so the shortest bar sits at the top, which is exactly where a
// manager's eye should land.
function RosterCard({ people, className }: { people: PersonLoad[]; className?: string }) {
  const t = useTranslations()
  return (
    <section
      className={cn('rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm', className)}
    >
      <CardHead title={t('dashboard.rosterTitle')} note={t('dashboard.rosterSubtitle')} />
      <ul className="mt-4 flex flex-col gap-2.5">
        {people.map((person) => (
          <RankRow
            key={person.userId}
            label={person.name}
            fill={person.total === 0 ? 0 : Math.round((person.done / person.total) * 100)}
            value={t('dashboard.openOf', { open: person.open, total: person.total })}
            lead={<Avatar name={person.name} className="size-6 flex-none" />}
          />
        ))}
      </ul>
    </section>
  )
}
