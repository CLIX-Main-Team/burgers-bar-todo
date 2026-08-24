import type { ProjectSummary } from '@burgers/shared'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../../components/ui/icon.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { isOverdue } from '../tasks/due-date.js'
import {
  PROJECT_FILL,
  PROJECT_ICON_ROLE,
  PROJECT_PHASE_LABEL_KEY,
  PROJECT_PHASE_TONE,
  PROJECT_TILE,
  useBranchLabel,
} from './project-look.js'
import { TicketRail } from './ticket-rail.js'

// One project in the grid. Four channels, each carrying exactly one fact — colour is which
// project, glyph is what kind of work, the rail is how far along, the date is when (see
// project-look.ts). The card is a link, not a decorated div: opening a project is navigation, so
// it earns a URL, a middle-click and a back button. The whole face is the target via the
// stretched-title pattern the board already uses, which keeps the avatar tooltips clickable.
export function ProjectCard({ project }: { project: ProjectSummary }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const branchLabel = useBranchLabel()
  const late = project.targetDate
    ? isOverdue(project.targetDate, project.status, new Date())
    : false
  const target = project.targetDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
        new Date(project.targetDate),
      )
    : null

  return (
    <li className="group relative flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-4 shadow-sm transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        {/* The identity tile. A rounded SQUARE holding a glyph, where a person is a circle holding
            initials — same palette, different shape, so a screen carrying both never has to
            explain which is which. */}
        <span
          className={cn(
            'inline-grid size-9 flex-none place-items-center rounded-[0.625rem]',
            PROJECT_TILE[project.colour],
          )}
        >
          <Icon name={PROJECT_ICON_ROLE[project.icon]} size="md" />
        </span>

        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${project.id}`}
            dir="auto"
            className="block truncate text-body font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {project.name}
          </Link>
          {/* Where it runs. Chain-wide is stated rather than left blank: an empty branch here
              would read as missing data instead of the deliberate answer it is. Past two branches
              the count replaces the names — a card is one line wide, and three truncated names
              say less than one honest number. */}
          {/* `dir` goes on the INNER span, not the paragraph. On the paragraph it would set the
              block's own direction from the branch names, and a Hebrew branch under a Latin title
              flushed itself to the opposite edge of the card. Inline, it still resolves the names'
              bidi correctly while the line stays where the rest of the card's text is. */}
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            <span dir="auto">{branchLabel(project.locations)}</span>
          </p>
        </div>

        {/* The affordance rests visible rather than appearing on hover: a card that only looks
            clickable once a pointer is on it is not discoverable on a touch screen at all.
            `row-forward` is a directional role, so it mirrors in RTL. */}
        <Icon
          name="row-forward"
          size="sm"
          className="mt-1 flex-none text-muted-foreground/50 transition-colors group-hover:text-foreground"
        />
      </div>

      <div className="flex flex-col gap-2">
        <TicketRail
          done={project.doneCount}
          total={project.taskCount}
          fill={PROJECT_FILL[project.colour]}
        />
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-caption tabular-nums text-muted-foreground">
            {t('projects.progress', { done: project.doneCount, total: project.taskCount })}
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

      {/* mt-auto pins the footer to the bottom edge, so a row of cards holding titles of different
          lengths still lines its dates and its avatars up. */}
      <div className="mt-auto flex items-center justify-between gap-2.5 border-t border-border pt-3">
        <span
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 text-caption',
            late ? 'font-semibold text-destructive' : 'text-muted-foreground',
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
        {/* The phase, which is the one thing on this card somebody sets by hand — and the one
            the app takes over the moment the checklist finishes. */}
        <span
          className={cn(
            'inline-flex flex-none items-center rounded-full px-[9px] py-[2px] text-caption font-bold',
            PROJECT_PHASE_TONE[project.phase],
          )}
        >
          {t(PROJECT_PHASE_LABEL_KEY[project.phase])}
        </span>
      </div>
    </li>
  )
}
