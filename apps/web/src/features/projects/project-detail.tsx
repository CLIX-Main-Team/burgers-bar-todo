import type { ProjectSummary, Task } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Avatar, AvatarStack } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { taskStatusLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { ApiError, authApi, tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { STATUS_DOT } from '../tasks/board-columns.js'
import { isOverdue } from '../tasks/due-date.js'
import { ProjectFormDialog } from './project-form-dialog.js'
import { PROJECT_FILL, PROJECT_ICON_ROLE, PROJECT_TILE, completionPercent } from './project-look.js'
import { PROJECTS_QUERY_KEY, projectDetailKey, useProject } from './project-queries.js'
import { TicketRail } from './ticket-rail.js'

// A project's own page: what it is, who is on it, and the work inside it.
//
// The task list is the point of this screen, so it gets the width and the details sit beside it.
// Those tasks are the SAME rows the board shows — the API filters the scoped board read by project
// id rather than querying tasks again — so ticking one here moves it on the kanban too, and the
// count above can never disagree with the list below it.
//
// There is no percentage control anywhere on this page. Progress IS the task list; a number
// somebody sets by hand would only ever be the one that turns out to be wrong.
export function ProjectDetailScreen() {
  const { projectId } = useParams()
  const query = useProject(projectId ?? '')

  if (!projectId) return <Navigate to="/projects" replace />

  if (query.isPending) return <DetailLoading />
  // A stale link is not an error worth a screen of its own — the grid is one step away and shows
  // what does exist.
  if (query.isError || !query.data) return <Navigate to="/projects" replace />

  return <ProjectDetail project={query.data.project} tasks={query.data.tasks} />
}

function ProjectDetail({ project, tasks }: { project: ProjectSummary; tasks: Task[] }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  // The lead picker needs every person, not just whoever already holds a task here — the point of
  // naming a lead is often to name somebody who is not on it yet. Fetched only while the dialog
  // is open.
  const peopleQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: authApi.listUsers,
    enabled: editing,
  })
  const late = project.targetDate
    ? isOverdue(project.targetDate, project.status, new Date())
    : false
  const formatDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) })
    queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
    // The board shows these same rows, so its cache is stale the moment one of them moves.
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  return (
    <div className="flex flex-col gap-4.5">
      <Link
        to="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="back" size="sm" />
        {t('projects.backToAll')}
      </Link>

      {/* The hero: identity, name, and the rail carrying the one figure this page is about. */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5 shadow-sm">
        <div className="flex items-start gap-3.5">
          <span
            className={cn(
              'inline-grid size-12 flex-none place-items-center rounded-xl',
              PROJECT_TILE[project.colour],
            )}
          >
            <Icon name={PROJECT_ICON_ROLE[project.icon]} size="lg" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 dir="auto" className="truncate text-heading-md font-extrabold text-foreground">
              {project.name}
            </h1>
            <p dir="auto" className="mt-0.5 truncate text-label text-muted-foreground">
              {project.locationName ?? t('projects.chainWide')}
              {project.phase ? ` · ${project.phase}` : ''}
            </p>
          </div>
          <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn('size-[7px] rounded-full', STATUS_DOT[project.status])}
            />
            {t(taskStatusLabelKey(project.status))}
          </span>
          <Button variant="secondary" onClick={() => setEditing(true)} className="flex-none">
            <Icon name="edit" size="sm" />
            {t('projects.edit')}
          </Button>
        </div>

        {/* Capped rather than stretched. One segment per task is only legible while a segment
            still looks like a notch — spread across the full width of a desktop card, six tasks
            read as five slabs and the count stops being countable. */}
        <div className="flex w-full max-w-[36rem] flex-col gap-2">
          <TicketRail
            done={project.doneCount}
            total={project.taskCount}
            fill={PROJECT_FILL[project.colour]}
            className="h-2.5"
          />
          <div className="flex items-center justify-between gap-2.5 text-caption text-muted-foreground">
            <span className="tabular-nums">
              {t('projects.progress', { done: project.doneCount, total: project.taskCount })}
            </span>
            <span className="tabular-nums">
              {t('projects.percentDone', { percent: completionPercent(project) })}
            </span>
          </div>
        </div>
      </div>

      {/* Details beside the work, not above it: the list is what somebody opens this page to
          read, so it takes the wider column from md up and the facts sit alongside. */}
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <section className="flex h-fit flex-col rounded-lg border border-border bg-card shadow-sm">
          <h2 className="border-b border-border px-4 py-3 text-body font-semibold text-foreground">
            {t('projects.details')}
          </h2>
          <dl className="flex flex-col divide-y divide-border px-4">
            <Field label={t('projects.lead')}>
              {project.lead ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={project.lead.displayName} className="size-[22px] text-[0.55rem]" />
                  <span dir="auto" className="truncate">
                    {project.lead.displayName}
                  </span>
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label={t('projects.team')}>
              {project.team.length > 0 ? (
                <AvatarStack
                  names={project.team.map((member) => member.displayName)}
                  label={t('projects.team')}
                />
              ) : (
                <Empty />
              )}
            </Field>
            <Field label={t('projects.branch')}>
              <span dir="auto">{project.locationName ?? t('projects.chainWide')}</span>
            </Field>
            <Field label={t('projects.startDate')}>
              {project.startDate ? formatDay(project.startDate) : <Empty />}
            </Field>
            <Field label={t('projects.fieldTarget')}>
              {project.targetDate ? (
                <span
                  className={cn('inline-flex items-center gap-1.5', late && 'text-destructive')}
                >
                  {formatDay(project.targetDate)}
                  {late && <span className="font-semibold">{t('projects.lateSuffix')}</span>}
                </span>
              ) : (
                <Empty />
              )}
            </Field>
            <Field label={t('projects.phase')}>
              {project.phase ? <span dir="auto">{project.phase}</span> : <Empty />}
            </Field>
          </dl>
        </section>

        <ProjectTasks
          project={project}
          tasks={tasks}
          canWrite={principal ? principal.role !== 'employee' : false}
          viewerId={principal?.userId ?? null}
          onChanged={refresh}
        />
      </div>

      {editing && principal && (
        <ProjectFormDialog
          open
          onClose={() => setEditing(false)}
          principal={principal}
          project={project}
          people={peopleQuery.data?.users ?? project.team}
        />
      )}
    </div>
  )
}

// The work itself. A checkbox per row, because that is the gesture this list is for — ticking one
// writes the status straight through the board's own status endpoint, which the API authorises by
// scope and which maintains completed_at by trigger.
function ProjectTasks({
  project,
  tasks,
  canWrite,
  viewerId,
  onChanged,
}: {
  project: ProjectSummary
  tasks: Task[]
  canWrite: boolean
  viewerId: string | null
  onChanged: () => void
}) {
  const t = useTranslations()
  const [title, setTitle] = useState('')
  const [failed, setFailed] = useState(false)

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      tasksApi.updateTaskStatus(id, done ? 'done' : 'not_started'),
    onSuccess: onChanged,
    onError: () => setFailed(true),
  })

  const addMutation = useMutation({
    mutationFn: (name: string) =>
      tasksApi.createTask({
        title: name,
        priority: 'normal',
        assigneeIds: [],
        // The project's own branch, or null for a chain-wide one — in which case the API resolves
        // the board from the acting principal, exactly as a task created anywhere else does.
        locationId: project.locationId,
        projectId: project.id,
      }),
    onSuccess: () => {
      setTitle('')
      onChanged()
    },
    onError: (error) => setFailed(error instanceof ApiError),
  })

  // Finished work sinks inside the list too, for the same reason it does in the grid.
  const ordered = [...tasks].sort(
    (a, b) => Number(a.status === 'done') - Number(b.status === 'done'),
  )

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3">
        <h2 className="text-body font-semibold text-foreground">{t('projects.tasks')}</h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {t('projects.doneOf', { done: project.doneCount, total: project.taskCount })}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="px-4 py-8 text-center text-label text-muted-foreground">
          {t('projects.noTasks')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {ordered.map((task) => {
            const done = task.status === 'done'
            const mine = viewerId ? task.assignees.some((one) => one.id === viewerId) : false
            return (
              <li key={task.id} className="flex items-center gap-2.5 px-4 py-2.5">
                {/* A real checkbox, visually hidden inside its label: the gesture this list
                    exists for should be the browser's own control, not a button imitating one.
                    Ticking it writes through the board's status endpoint, so the same row moves
                    on the kanban. */}
                <label
                  className={cn(
                    'relative inline-grid size-5 flex-none cursor-pointer place-items-center rounded-md border transition',
                    done
                      ? 'border-transparent bg-status-done-dot text-white'
                      : 'border-border-strong text-transparent hover:border-foreground',
                    'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-card',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={done}
                    disabled={toggleMutation.isPending}
                    onChange={() => toggleMutation.mutate({ id: task.id, done: !done })}
                    aria-label={t('projects.toggleTask', { title: task.title })}
                  />
                  <Icon name="selected" size="sm" />
                </label>

                <div className="min-w-0 flex-1">
                  <p
                    dir="auto"
                    className={cn(
                      'truncate text-body',
                      // Struck through AND greyed: the line alone is a colour-free signal, and the
                      // ink change keeps a finished row from competing with the live ones.
                      done ? 'text-muted-foreground line-through' : 'font-medium text-foreground',
                    )}
                  >
                    {task.title}
                  </p>
                  {task.assignees.length > 0 && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
                      {mine && <Badge variant="accent">{t('projects.mine')}</Badge>}
                      <span dir="auto" className="truncate">
                        {task.assignees.map((one) => one.displayName).join(', ')}
                      </span>
                    </p>
                  )}
                </div>

                <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn('size-[7px] rounded-full', STATUS_DOT[task.status])}
                  />
                  {t(taskStatusLabelKey(task.status))}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {/* Adding work where the work is. One field and one button, because a task inside a project
          starts as a line somebody types while reading the list — everything else about it is
          edited afterwards on the board. */}
      {canWrite && (
        <form
          className="flex items-center gap-2 border-t border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            const next = title.trim()
            if (!next) return
            setFailed(false)
            addMutation.mutate(next)
          }}
        >
          <Icon name="create" size="sm" className="flex-none text-muted-foreground" />
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('projects.addTaskPlaceholder')}
            aria-label={t('projects.addTask')}
            className="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={addMutation.isPending || !title.trim()}
            className="flex-none"
          >
            {addMutation.isPending ? t('common.working') : t('projects.addTask')}
          </Button>
        </form>
      )}

      {failed && (
        <p className="border-t border-border px-4 py-2 text-caption text-destructive">
          {t('projects.taskFailed')}
        </p>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex-none text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-label font-semibold text-foreground">{children}</dd>
    </div>
  )
}

// An unset field reads as a dash rather than as blank space, so "nobody has set this" and "this
// row failed to load" never look the same.
function Empty() {
  return <span className="text-muted-foreground">—</span>
}

function DetailLoading() {
  const t = useTranslations()
  return (
    <div aria-busy="true" aria-label={t('projects.loading')} className="flex flex-col gap-4.5">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-12 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  )
}
