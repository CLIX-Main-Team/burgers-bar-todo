import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { isOverdue } from '../tasks/due-date.js'
import {
  type DemoProject,
  PROJECT_KIND_ICON,
  projectFill,
  projectKindLabelKey,
  projectTile,
} from './project-fixtures.js'
import { TicketRail } from './ticket-rail.js'

// One project in the grid. Four channels, and each one carries exactly one fact:
//
//   colour  — WHICH project (hashed from the name, the same palette a person wears)
//   glyph   — WHAT KIND of work it is (menu, opening, audit, …)
//   rail    — HOW FAR along, one segment per task
//   date    — WHEN it is expected, in the destructive ink once that day has passed
//
// Keeping them separate is the whole design. The previous card spent its only colour on a
// progress fill that every card painted identically, so a grid of projects was a grid of
// grey rectangles and the eye had to read every title to find anything.
//
// The card is a link, not a button: opening a project is navigation, so it earns a URL, a
// middle-click and a back button. The whole face is the target via the stretched-title
// pattern the board already uses (`after:absolute after:inset-0`), which keeps the avatar
// tooltips and any control added later clickable inside it.
export function ProjectCard({ project }: { project: DemoProject }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const language = locale === 'he' ? 'he' : 'en'
  const late = isOverdue(project.targetDate, project.status, new Date())
  const target = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(project.targetDate),
  )

  return (
    <li className="group relative flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        {/* The identity tile. A rounded SQUARE holding a glyph, where a person is a circle
            holding initials — same palette, different shape, so a screen carrying both never
            has to explain which is which. */}
        <span
          className={cn(
            'inline-grid size-9 flex-none place-items-center rounded-[0.625rem]',
            projectTile(project),
          )}
        >
          <Icon name={PROJECT_KIND_ICON[project.kind]} size="md" />
        </span>

        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            dir="auto"
            className="block truncate text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {project.name[language]}
          </Link>
          {/* What kind of work, and where it runs. Chain-wide is stated rather than left
              blank: an empty branch here would read as missing data instead of as the
              deliberate answer it is. */}
          <p dir="auto" className="mt-0.5 truncate text-caption text-muted-foreground">
            {t(projectKindLabelKey(project.kind))}
            {' · '}
            {project.branch ? project.branch[language] : t('projects.chainWide')}
          </p>
        </div>

        {/* The affordance. It rests visible rather than appearing on hover, because a card
            that only looks clickable once the pointer is on it is not discoverable on a
            touch screen at all. `row-forward` is a directional role, so it mirrors in RTL. */}
        <Icon
          name="row-forward"
          size="sm"
          className="mt-1 flex-none text-muted-foreground/50 transition-colors group-hover:text-foreground"
        />
      </div>

      <div className="flex flex-col gap-2">
        <TicketRail done={project.done} total={project.total} fill={projectFill(project)} />
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('projects.progress', { done: project.done, total: project.total })}
          </span>
          {/* The board's own dot and the board's own three words, so a project's state and a
              task's state are read the same way across the app. */}
          <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn('size-[7px] rounded-full', STATUS_DOT[project.status])}
            />
            {t(taskStatusLabelKey(project.status))}
          </span>
        </div>
      </div>

      {/* mt-auto pins the footer to the bottom edge, so a row of cards holding titles of
          different lengths still lines its dates and its avatars up. */}
      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-border pt-3">
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 text-caption',
            late ? 'font-semibold text-destructive' : 'text-muted-foreground',
          )}
        >
          <Icon name={late ? 'overdue' : 'due-date'} size="sm" className="flex-none" />
          <span className="truncate">
            {late
              ? t('projects.pastTarget', { date: target })
              : t('projects.target', { date: target })}
          </span>
        </span>
        <AvatarStack
          names={project.owners.map((owner) => owner[language])}
          label={t('projects.owners')}
        />
      </div>
    </li>
  )
}
