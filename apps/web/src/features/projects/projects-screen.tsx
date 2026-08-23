import { useTranslations } from 'use-intl'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { ProjectCard } from './project-card.js'
import { DEMO_PROJECTS, projectTotals, sortForBoard } from './project-fixtures.js'

// The `/projects` screen. A project is the container the chain already talks in — a menu
// rollout, a branch opening, an audit — and this screen answers the one question a manager
// opens it for: which of these is moving, and which is stuck.
//
// Front-end only by the owner's call: the rows come from project-fixtures.ts, nothing is
// written, and the screen wears a "sample data" badge beside its own title rather than
// pretending. That badge is what should be deleted first when the real table lands.
//
// The head is deliberately quiet — one title, one line, one disabled action — because the
// cards are where this page spends its colour. Three stacked grey lines under an h1 is the
// shape a page takes when nobody decided what mattered.
export function ProjectsScreen() {
  const t = useTranslations()
  const projects = sortForBoard(DEMO_PROJECTS)
  const totals = projectTotals(DEMO_PROJECTS)

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-heading-lg font-extrabold text-foreground">
              {t('projects.title')}
            </h1>
            <Badge>{t('projects.sampleBadge')}</Badge>
          </div>
          {/* Subtitle and scoreboard on one line: what this screen is for, then how much of
              it is done. The count is the only number on the page that spans every project,
              which is exactly why it belongs in the head and not on a card. */}
          <p className="mt-0.5 text-label text-muted-foreground">
            {t('projects.subtitle')}
            {' · '}
            <span className="tabular-nums">
              {t('projects.summary', { done: totals.done, total: totals.total })}
            </span>
          </p>
        </div>
        {/* The handoff's header action. It is disabled rather than absent: the screen's shape
            is the thing under review, and a button that silently did nothing would be the
            worse of the two lies. It turns on with the backlog behind it. */}
        <Button disabled className="whitespace-nowrap">
          <Icon name="create" size="sm" />
          {t('projects.newProject')}
        </Button>
      </div>

      {/* Open work leads and finished work sinks (sortForBoard): a manager opens this to find
          what needs them, and a closed project never does. */}
      <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </ul>
    </div>
  )
}
