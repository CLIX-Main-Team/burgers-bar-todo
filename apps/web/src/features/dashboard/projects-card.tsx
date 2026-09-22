import type { ProjectSummary } from '@burgers/shared'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { rowDelayStyle } from '../../lib/motion.js'
import {
  PROJECT_FILL,
  PROJECT_ICON_ROLE,
  PROJECT_TILE,
  sortForBoard,
  useBranchLabel,
} from '../projects/project-look.js'
import { useProjects } from '../projects/project-queries.js'
import { TicketRail } from '../projects/ticket-rail.js'
import { isOverdue } from '../tasks/due-date.js'
import { DashboardCard } from './dashboard-card.js'

// Projects running: openings, rollouts and audits in flight, as tiles (round 3, 2026-09-22; the
// strip itself dates from round 11). Real rows from `/projects`, scoped by the API exactly as
// that screen is. It speaks the /projects card's grammar: the colour square and its glyph say
// WHICH project, the rail says how far along with one segment per step, and the date owns the
// tile's foot, in the destructive ink once it has passed.
//
// A tile keeps the CARD surface with a hairline rather than sinking like the overview tiles: the
// rail's unspent segments are drawn in muted, and muted on a sunken ground is muted on muted at
// night, where a project at 1 of 2 would read as a full bar (the round-11 lesson on bg-lane).
//
// Only work still running is listed; a finished project is something to read about on the
// projects screen, never something to act on from here.

const LIMIT = 6

export function ProjectsCard({
  now,
  canWrite,
  delay,
  className,
}: {
  now: Date
  canWrite: boolean
  delay: number
  className?: string
}) {
  const t = useTranslations()
  const query = useProjects()
  const running = sortForBoard(query.data?.projects ?? []).filter(
    (project) => project.status !== 'done',
  )
  const shown = running.slice(0, LIMIT)
  const hidden = running.length - shown.length

  // Nothing running, and nothing this viewer could do about it: an employee on no project gets
  // the space back rather than an empty box explaining an absence to them.
  const settled = !query.isPending && !query.isError
  if (settled && running.length === 0 && !canWrite) return null

  return (
    <DashboardCard
      title={t('dashboard.projectsTitle')}
      note={t('dashboard.projectsNote')}
      delay={delay}
      className={className}
      action={
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-label font-semibold text-link underline-offset-4 hover:underline"
        >
          {t('dashboard.allProjects')}
          <Icon name="row-forward" size="sm" />
        </Link>
      }
    >
      {query.isPending ? (
        <ul
          aria-busy="true"
          aria-label={t('projects.loading')}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((slot) => (
            <li
              key={slot}
              className="flex flex-col gap-3 rounded-[0.875rem] border border-border p-4"
            >
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-9 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
              <Skeleton className="h-3 w-1/2" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        // A card that cannot load says so and offers the one move that helps; every other card
        // on the page came from a different request and is still true.
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-sunken px-4 py-3">
          <p className="text-label text-muted-foreground">{t('projects.errorTitle')}</p>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <Icon name="retry" size="sm" />
            {t('common.retry')}
          </Button>
        </div>
      ) : running.length === 0 ? (
        <p className="rounded-lg bg-surface-sunken px-4 py-6 text-center text-label text-muted-foreground">
          {t('dashboard.projectsEmpty')}
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((project, index) => (
              <ProjectTile
                key={project.id}
                project={project}
                now={now}
                style={rowDelayStyle(delay + 140, index)}
              />
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="mt-3 text-caption text-muted-foreground">
              {t('dashboard.projectsMore', { count: hidden })}
            </p>
          ) : null}
        </>
      )}
    </DashboardCard>
  )
}

function ProjectTile({
  project,
  now,
  style,
}: {
  project: ProjectSummary
  now: Date
  style: CSSProperties
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const branchLabel = useBranchLabel()
  const late = project.targetDate ? isOverdue(project.targetDate, project.status, now) : false
  const target = project.targetDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
        new Date(project.targetDate),
      )
    : null

  return (
    // A tile is a link, not a decorated div: opening a project is navigation, so it earns a URL,
    // a middle-click and a back button. The whole face is the target through the stretched
    // title, the pattern the projects grid and the board share.
    <li
      className="group relative flex min-w-0 flex-col gap-3 rounded-[0.875rem] border border-border bg-card p-4 transition-colors hover:border-border-strong motion-safe:animate-settle"
      style={style}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'inline-grid size-9 flex-none place-items-center rounded-lg',
            PROJECT_TILE[project.colour],
          )}
        >
          <Icon name={PROJECT_ICON_ROLE[project.icon]} size="sm" />
        </span>
        {/* items-start and a shrink-wrapped title: a Hebrew name under dir=auto must hug the
            start of the tile as an English one does (round 11's stretched-block lesson). */}
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <Link
            to={`/projects/${project.id}`}
            dir="auto"
            className="block max-w-full truncate text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[0.875rem] focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {project.name}
          </Link>
          <p className="max-w-full truncate text-caption text-muted-foreground">
            <span dir="auto">{branchLabel(project.locations)}</span>
          </p>
        </div>
      </div>

      <TicketRail
        done={project.doneCount}
        total={project.taskCount}
        fill={PROJECT_FILL[project.colour]}
      />

      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span className="flex-none tabular-nums">
          {t('projects.progress', { done: project.doneCount, total: project.taskCount })}
        </span>
        <span
          className={cn(
            'ms-auto inline-flex min-w-0 items-center gap-1',
            late && 'font-semibold text-destructive',
          )}
        >
          <Icon name={late ? 'overdue' : 'due-date'} size="sm" className="flex-none" />
          <span className="truncate">
            {target === null
              ? t('projects.noTarget')
              : late
                ? t('projects.pastTarget', { date: target })
                : t('projects.target', { date: target })}
          </span>
        </span>
      </div>
    </li>
  )
}
