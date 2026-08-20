import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { DEMO_PROJECTS, type DemoProject, completionPercent } from './project-fixtures.js'

// The `/projects` screen (v2, round 10). A project is the container the chain already talks
// in — a menu rollout, a branch opening, an audit — and this screen answers the one question
// a manager opens it for: how far along is each one, and who is carrying it.
//
// Front-end only by the owner's call: the rows come from project-fixtures.ts, nothing is
// written, and the screen says "sample data" under its own subtitle rather than pretending.
// That line is what should be deleted first when the real table lands.
//
// The card borrows the board's grammar rather than inventing one: the same status dot and
// the same three status words, the AvatarStack the task card and the list row already wear,
// and the blue primary as the progress fill so the one accent colour stays the one accent.
export function ProjectsScreen() {
  const t = useTranslations()

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-heading-lg font-extrabold text-foreground">{t('projects.title')}</h1>
          <p className="mt-0.5 text-label text-muted-foreground">{t('projects.subtitle')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('projects.sampleData')}</p>
        </div>
        {/* The handoff's header action. It is disabled rather than absent: the screen's shape
            is the thing under review, and a button that silently did nothing would be the
            worse of the two lies. It turns on with the backlog behind it. */}
        <Button disabled className="whitespace-nowrap">
          <Icon name="create" size="sm" />
          {t('projects.newProject')}
        </Button>
      </div>

      <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {DEMO_PROJECTS.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </ul>
    </div>
  )
}

function ProjectCard({ project }: { project: DemoProject }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const language = locale === 'he' ? 'he' : 'en'
  const percent = completionPercent(project)

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-[15px] shadow-sm">
      <div className="flex items-start gap-2.5">
        <h2 dir="auto" className="min-w-0 flex-1 text-body font-semibold text-foreground">
          {project.name[language]}
        </h2>
        <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn('size-[7px] rounded-full', STATUS_DOT[project.status])}
          />
          {t(taskStatusLabelKey(project.status))}
        </span>
      </div>

      {/* Where it runs and who is carrying it. Chain-wide is stated rather than left blank:
          on this screen an empty branch would read as missing data instead of as the
          deliberate answer it is. */}
      <p dir="auto" className="truncate text-caption text-muted-foreground">
        {[
          project.branch ? project.branch[language] : t('projects.chainWide'),
          project.owners[0]?.[language],
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="flex flex-col gap-1.5">
        {/* The bar is decorative — the count below states the same thing in words, and a
            screen reader should hear it once, not twice. */}
        <div aria-hidden="true" className="h-[5px] overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('projects.progress', { done: project.done, total: project.total })}
          </span>
          <AvatarStack
            names={project.owners.map((owner) => owner[language])}
            label={t('projects.owners')}
          />
        </div>
      </div>
    </li>
  )
}
