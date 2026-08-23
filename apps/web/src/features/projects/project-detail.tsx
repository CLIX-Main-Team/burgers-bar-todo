import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { isOverdue } from '../tasks/due-date.js'
import {
  DEMO_PROJECTS,
  type DemoProject,
  PROJECT_KIND_ICON,
  completionPercent,
  projectFill,
  projectKindLabelKey,
  projectTile,
} from './project-fixtures.js'
import { TicketRail } from './ticket-rail.js'

// NOTE: never reach for a named `max-w-sm`/`max-w-3xl` here. index.css redefines
// --spacing-* , and Tailwind reads that same scale for max-width, so `max-w-3xl` resolves to
// 68px in this app and folds a page to one word per line. Constrained widths are explicit.
//
// Where a project card's click lands. It is deliberately a small screen: the card grid was
// this round's work, and a project has no tasks of its own until the table exists, so the one
// thing this page must not do is invent a body for itself. It restates what the card showed
// at a size worth reading, and says plainly that the task list is not wired yet.
//
// It exists at all because the alternative was a card that looks clickable and isn't.
export function ProjectDetailScreen() {
  const { projectId } = useParams()
  const project = DEMO_PROJECTS.find((row) => row.id === projectId)

  // An unknown id is a stale link, not an error worth a screen of its own — the grid is one
  // step away and shows what does exist.
  if (!project) return <Navigate to="/projects" replace />

  return <ProjectDetail project={project} />
}

function ProjectDetail({ project }: { project: DemoProject }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const language = locale === 'he' ? 'he' : 'en'
  const late = isOverdue(project.targetDate, project.status, new Date())
  const target = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(project.targetDate),
  )

  return (
    <div className="flex w-full max-w-[46rem] flex-col gap-4.5">
      <Link
        to="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="back" size="sm" />
        {t('projects.backToAll')}
      </Link>

      <div className="flex flex-col gap-4.5 rounded-lg border border-border bg-card px-5 py-5 shadow-sm">
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              'inline-grid size-12 flex-none place-items-center rounded-xl',
              projectTile(project),
            )}
          >
            <Icon name={PROJECT_KIND_ICON[project.kind]} size="lg" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 dir="auto" className="text-heading-md font-extrabold text-foreground">
                {project.name[language]}
              </h1>
              <Badge>{t('projects.sampleBadge')}</Badge>
            </div>
            <p dir="auto" className="mt-0.5 text-label text-muted-foreground">
              {t(projectKindLabelKey(project.kind))}
              {' · '}
              {project.branch ? project.branch[language] : t('projects.chainWide')}
            </p>
          </div>
        </div>

        {/* The same rail the card wears, at the size a page can afford. It is the one thing
            worth enlarging here — everything else is a word. */}
        <div className="flex flex-col gap-2">
          <TicketRail
            done={project.done}
            total={project.total}
            fill={projectFill(project)}
            className="h-2.5"
          />
          <div className="flex items-center justify-between gap-2.5 text-caption text-muted-foreground">
            <span className="tabular-nums">
              {t('projects.progress', { done: project.done, total: project.total })}
            </span>
            <span className="tabular-nums">
              {t('projects.percentDone', { percent: completionPercent(project) })}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2">
          <Field label={t('projects.fieldStatus')}>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('size-[7px] rounded-full', STATUS_DOT[project.status])}
              />
              {t(taskStatusLabelKey(project.status))}
            </span>
          </Field>
          <Field label={t('projects.fieldTarget')}>
            <span className={cn('inline-flex items-center gap-1.5', late && 'text-destructive')}>
              <Icon name={late ? 'overdue' : 'due-date'} size="sm" />
              {target}
              {late && <span className="font-semibold">{t('projects.lateSuffix')}</span>}
            </span>
          </Field>
          <Field label={t('projects.fieldBranch')}>
            <span dir="auto">
              {project.branch ? project.branch[language] : t('projects.chainWide')}
            </span>
          </Field>
          <Field label={t('projects.owners')}>
            <AvatarStack
              names={project.owners.map((owner) => owner[language])}
              label={t('projects.owners')}
            />
          </Field>
        </dl>
      </div>

      {/* The honest empty state. It names what is missing and who it is waiting on, rather
          than showing an empty list that looks like a project with no work in it. */}
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border border-dashed bg-card/40 px-5 py-10 text-center">
        <Icon name="board-empty" size="lg" className="text-muted-foreground" />
        <p className="text-body font-semibold text-foreground">{t('projects.tasksTitle')}</p>
        <p className="max-w-[38ch] text-label text-muted-foreground">
          {t('projects.tasksPending')}
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body font-semibold text-foreground">{children}</dd>
    </div>
  )
}
