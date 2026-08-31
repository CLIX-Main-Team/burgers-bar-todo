import { type CSSProperties, useState } from 'react'
import { useTranslations } from 'use-intl'
import { hasCapability } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { useRowStagger } from '../../lib/use-row-stagger.js'
import { ProjectCard } from './project-card.js'
import { ProjectFormDialog } from './project-form-dialog.js'
import { projectTotals, sortForBoard } from './project-look.js'
import { useProjects } from './project-queries.js'

// The `/projects` screen. A project is the container the chain already talks in — a menu rollout,
// a branch opening, an audit — and this screen answers the one question a manager opens it for:
// which of these is moving, and which is stuck.
//
// Real rows now, from `/projects`, scoped by the API (ADR-0007): a manager sees their own branch's
// projects plus every chain-wide one, an admin sees the chain. The counts on each card describe
// exactly the tasks the same principal would be shown inside it, so the number on the card and the
// list behind it can never disagree.
//
// The head is deliberately quiet — one title, one line, one action — because the cards are where
// this page spends its colour.
export function ProjectsScreen() {
  const t = useTranslations()
  const projectGrid = useRowStagger<HTMLUListElement>(80)
  const [creating, setCreating] = useState(false)
  const { principal } = useSession()
  const query = useProjects()
  // Creating stays manager-and-up. An employee opens this screen — the projects naming their
  // role — but is never shown a button the API would refuse.
  const canWrite = principal ? hasCapability(principal, 'projects.manage') : false

  const projects = sortForBoard(query.data?.projects ?? [])
  const totals = projectTotals(projects)

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex items-start justify-between gap-4 motion-safe:animate-rise">
        <div className="min-w-0">
          <h1 className="text-heading-lg font-extrabold text-foreground">{t('projects.title')}</h1>
          {/* Subtitle and scoreboard on one line: what this screen is for, then how much of it is
              done. The count is the only number on the page that spans every project, which is
              exactly why it belongs in the head and not on a card. */}
          <p className="mt-0.5 text-label text-muted-foreground">
            {t('projects.subtitle')}
            {projects.length > 0 && (
              <>
                {' · '}
                <span className="tabular-nums">
                  {t('projects.summary', { done: totals.done, total: totals.total })}
                </span>
              </>
            )}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)} className="whitespace-nowrap">
            <Icon name="create" size="sm" />
            {t('projects.newProject')}
          </Button>
        )}
      </div>

      {query.isPending ? (
        <ProjectsLoading />
      ) : query.isError ? (
        <StatePanel
          icon="board-error"
          title={t('projects.errorTitle')}
          body={t('projects.errorBody')}
          action={
            <Button variant="secondary" onClick={() => query.refetch()}>
              <Icon name="retry" size="sm" />
              {t('common.retry')}
            </Button>
          }
        />
      ) : projects.length === 0 ? (
        <StatePanel
          icon="board-empty"
          title={t('projects.emptyTitle')}
          body={t('projects.emptyBody')}
          action={
            canWrite ? (
              <Button onClick={() => setCreating(true)}>
                <Icon name="create" size="sm" />
                {t('projects.newProject')}
              </Button>
            ) : null
          }
        />
      ) : (
        // Open work leads and finished work sinks (sortForBoard): a manager opens this to find
        // what needs them, and a closed project never does.
        <ul
          ref={projectGrid}
          className="bb-stagger-rows grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}

      {creating && principal && (
        <ProjectFormDialog
          open
          onClose={() => setCreating(false)}
          principal={principal}
          project={null}
        />
      )}
    </div>
  )
}

// Silhouettes shaped like the real cards rather than a spinner on a blank screen, so the grid does
// not jump when the data lands.
function ProjectsLoading() {
  const t = useTranslations()
  return (
    <ul
      aria-busy="true"
      aria-label={t('projects.loading')}
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[0, 1, 2, 3, 4, 5].map((slot) => (
        <li
          key={slot}
          className="flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-4"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-[0.625rem]" />
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
  )
}

function StatePanel({
  icon,
  title,
  body,
  action,
}: {
  icon: 'board-empty' | 'board-error'
  title: string
  body: string
  action: React.ReactNode | null
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card/40 px-5 py-12 text-center">
      <Icon name={icon} size="lg" className="text-muted-foreground" />
      <p className="text-body font-semibold text-foreground">{title}</p>
      <p className="max-w-[38ch] text-label text-muted-foreground">{body}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
