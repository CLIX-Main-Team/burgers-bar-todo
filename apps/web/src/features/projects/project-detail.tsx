import type { ProjectChecklistItem, ProjectSummary } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { useLocale } from '../../i18n/locale.js'
import { ApiError, projectsApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { isOverdue } from '../tasks/due-date.js'
import { ProjectFormDialog } from './project-form-dialog.js'
import {
  PROJECT_FILL,
  PROJECT_ICON_LABEL_KEY,
  PROJECT_ICON_ROLE,
  PROJECT_PHASE_LABEL_KEY,
  PROJECT_PHASE_TONE,
  PROJECT_ROLE_LABEL_KEY,
  PROJECT_TILE,
  completionPercent,
} from './project-look.js'
import { PROJECTS_QUERY_KEY, projectDetailKey, useProject } from './project-queries.js'
import { TicketRail } from './ticket-rail.js'

// A project's own page: what it is, who it is for, and the checklist inside it.
//
// The checklist is the point of this screen, so it gets the width and the facts sit beside it. It
// is also the project's ONLY progress figure — there is no percentage control anywhere here, and
// no way to mark a project finished by hand, because the checklist already answers both. Tick the
// last item and the phase moves to Completed on its own; un-tick one and it moves back off.
export function ProjectDetailScreen() {
  const { projectId } = useParams()
  const query = useProject(projectId ?? '')

  if (!projectId) return <Navigate to="/projects" replace />
  if (query.isPending) return <DetailLoading />
  // A stale link, and a project this person's role is not named on, are the same thing from here:
  // the grid is one step away and shows what they can actually open.
  if (query.isError || !query.data) return <Navigate to="/projects" replace />

  return <ProjectDetail project={query.data.project} checklist={query.data.checklist} />
}

function ProjectDetail({
  project,
  checklist,
}: {
  project: ProjectSummary
  checklist: ProjectChecklistItem[]
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const late = project.targetDate
    ? isOverdue(project.targetDate, project.status, new Date())
    : false
  const formatDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  // Creating and editing stay manager-and-up; the API enforces it and the screen mirrors it, so an
  // employee reading a project is never shown a control that would be refused.
  const canWrite = principal ? principal.role !== 'employee' : false

  return (
    <div className="flex flex-col gap-4.5">
      <Link
        to="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-label text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="back" size="sm" />
        {t('projects.backToAll')}
      </Link>

      {/* The hero: identity, name, phase, and the rail carrying the one figure this page is
          about. */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3.5">
          <span
            className={cn(
              'inline-grid size-12 flex-none place-items-center rounded-xl',
              PROJECT_TILE[project.colour],
            )}
          >
            <Icon
              name={PROJECT_ICON_ROLE[project.icon]}
              size="lg"
              label={t(PROJECT_ICON_LABEL_KEY[project.icon])}
            />
          </span>
          <div className="min-w-0 flex-1">
            <h1 dir="auto" className="truncate text-heading-md font-extrabold text-foreground">
              {project.name}
            </h1>
            <p dir="auto" className="mt-0.5 truncate text-label text-muted-foreground">
              {project.locationName ?? t('projects.chainWide')}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex flex-none items-center rounded-full px-2.5 py-1 text-caption font-bold',
              PROJECT_PHASE_TONE[project.phase],
            )}
          >
            {t(PROJECT_PHASE_LABEL_KEY[project.phase])}
          </span>
          {canWrite && (
            <Button variant="secondary" onClick={() => setEditing(true)} className="flex-none">
              <Icon name="edit" size="sm" />
              {t('projects.edit')}
            </Button>
          )}
        </div>

        {/* Capped rather than stretched. One segment per item is only legible while a segment
            still looks like a notch — spread across the full width of a desktop card, six items
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

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <section className="flex h-fit flex-col rounded-lg border border-border bg-card shadow-sm">
          <h2 className="border-b border-border px-4 py-3 text-body font-semibold text-foreground">
            {t('projects.details')}
          </h2>
          <dl className="flex flex-col divide-y divide-border px-4">
            {/* Roles first: on this screen it is the field that decides who is reading it. */}
            <Field label={t('projects.forRoles')}>
              {project.roles.length > 0 ? (
                project.roles.map((role) => t(PROJECT_ROLE_LABEL_KEY[role])).join(', ')
              ) : (
                <Empty />
              )}
            </Field>
            <Field label={t('projects.branch')}>
              <span dir="auto">{project.locationName ?? t('projects.chainWide')}</span>
            </Field>
            <Field label={t('projects.phase')}>{t(PROJECT_PHASE_LABEL_KEY[project.phase])}</Field>
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
          </dl>
        </section>

        <ProjectChecklist
          project={project}
          items={checklist}
          canWrite={canWrite}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: projectDetailKey(project.id) })
            queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
          }}
        />
      </div>

      {editing && principal && (
        <ProjectFormDialog
          open
          onClose={() => setEditing(false)}
          principal={principal}
          project={project}
        />
      )}
    </div>
  )
}

// The checklist. A tick per row, because that is the gesture this list is for — and the reason
// there is no "mark this project done" button anywhere on the page: the last tick does it.
function ProjectChecklist({
  project,
  items,
  canWrite,
  onChanged,
}: {
  project: ProjectSummary
  items: ProjectChecklistItem[]
  canWrite: boolean
  onChanged: () => void
}) {
  const t = useTranslations()
  const [title, setTitle] = useState('')
  const [failed, setFailed] = useState(false)

  const toggleMutation = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      projectsApi.setChecklistItemDone(project.id, id, done),
    onSuccess: onChanged,
    onError: () => setFailed(true),
  })

  const addMutation = useMutation({
    mutationFn: (name: string) => projectsApi.addChecklistItem(project.id, name),
    onSuccess: () => {
      setTitle('')
      onChanged()
    },
    onError: (error) => setFailed(error instanceof ApiError),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => projectsApi.deleteChecklistItem(project.id, id),
    onSuccess: onChanged,
    onError: () => setFailed(true),
  })

  const busy = toggleMutation.isPending || addMutation.isPending || removeMutation.isPending

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3">
        <h2 className="text-body font-semibold text-foreground">{t('projects.checklist')}</h2>
        <span className="text-caption tabular-nums text-muted-foreground">
          {t('projects.doneOf', { done: project.doneCount, total: project.taskCount })}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-label text-muted-foreground">
          {canWrite ? t('projects.noItems') : t('projects.noItemsReadOnly')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2.5 px-4 py-2.5">
              {/* A real checkbox, visually hidden inside its label: the gesture this list exists
                  for should be the browser's own control, not a button imitating one. */}
              <label
                className={cn(
                  'inline-grid size-5 flex-none place-items-center rounded-md border transition',
                  item.done
                    ? 'border-transparent bg-status-done-dot text-white'
                    : 'border-border-strong text-transparent hover:border-foreground',
                  canWrite ? 'cursor-pointer' : 'cursor-default opacity-70',
                  'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-card',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={item.done}
                  disabled={busy || !canWrite}
                  onChange={() => toggleMutation.mutate({ id: item.id, done: !item.done })}
                  aria-label={t('projects.toggleItem', { title: item.title })}
                />
                <Icon name="selected" size="sm" />
              </label>

              <span
                dir="auto"
                className={cn(
                  'min-w-0 flex-1 truncate text-body',
                  // Struck through AND greyed: the line alone is a colour-free signal, and the ink
                  // change keeps a finished row from competing with the live ones.
                  item.done ? 'text-muted-foreground line-through' : 'font-medium text-foreground',
                )}
              >
                {item.title}
              </span>

              {canWrite && (
                <button
                  type="button"
                  aria-label={t('projects.removeItem', { title: item.title })}
                  disabled={busy}
                  onClick={() => removeMutation.mutate(item.id)}
                  // Hidden until the row is hovered or the button itself is focused: a delete on
                  // every row is a lot of destructive ink for a list somebody is mostly reading.
                  // focus-visible keeps it reachable from the keyboard regardless.
                  className="flex-none rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <Icon name="delete" size="sm" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

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
            placeholder={t('projects.addItemPlaceholder')}
            aria-label={t('projects.addItem')}
            className="h-9 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || !title.trim()}
            className="flex-none"
          >
            {addMutation.isPending ? t('common.working') : t('projects.addItem')}
          </Button>
        </form>
      )}

      {failed && (
        <p className="border-t border-border px-4 py-2 text-caption text-destructive">
          {t('projects.itemFailed')}
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
        <Skeleton className="h-2.5 w-full max-w-[36rem] rounded-full" />
      </div>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  )
}
