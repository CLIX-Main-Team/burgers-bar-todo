import { type ProjectChecklistItem, type ProjectSummary, isSuperAdmin } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { hasCapability } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { roleLabelKey } from '../../i18n/labels.js'
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
  PROJECT_ROLES,
  PROJECT_TILE,
  completionPercent,
  isAlwaysInvolved,
  useBranchLabel,
} from './project-look.js'
import {
  PROJECTS_QUERY_KEY,
  projectCandidatesKey,
  projectDetailKey,
  useProject,
} from './project-queries.js'
import { StepOwners } from './step-owners.js'
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
  const branchLabel = useBranchLabel()
  const { principal } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const late = project.targetDate
    ? isOverdue(project.targetDate, project.status, new Date())
    : false
  const formatDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  // Two different questions since 2026-08-25, and the page asks both.
  //
  // Authoring — renaming the project, restructuring its checklist — belongs to whoever the project
  // is FOR: the owner anywhere, a branch admin on a project filed at their branch and nowhere
  // else. A rollout that merely reaches their branch is not theirs to rewrite, so the Edit button
  // has to weigh the project in front of it, not just the capability.
  //
  // Ticking a line is doing the work, and belongs to everyone the project reaches — the scope
  // predicate has already decided who that is by the time this page renders.
  const canAuthor =
    principal !== null &&
    hasCapability(principal, 'projects.manage') &&
    (isSuperAdmin(principal.role) ||
      (project.locations.length === 1 && project.locations[0]?.id === principal.locationId))
  const canTick = principal ? hasCapability(principal, 'projects.checklist') : false
  // Handing a step to somebody is authoring, not doing (owner call 2026-08-28), so it rides its
  // own capability rather than the tick's — and unlike `canAuthor` it does NOT ask whether this
  // project is filed at the principal's own branch. Naming somebody the project already reaches
  // changes nothing about what the project IS; it says who is doing a line of it.
  const canAssign = principal ? hasCapability(principal, 'projects.assign') : false
  // Who is on it, read the way the API reads it rather than off the stored list: the admin roles
  // come with the branches (2026-08-25), so a project filed before that rule was written still
  // says so here instead of naming the managers alone and leaving the admin reading it to wonder
  // why the page opened at all.
  const involvedRoles = PROJECT_ROLES.filter(
    (role) => isAlwaysInvolved(role) || project.roles.includes(role),
  )

  return (
    <div className="bb-stagger flex flex-col gap-4.5">
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
            {/* `dir` on the inner span, never the paragraph — see project-card.tsx. */}
            <p className="mt-0.5 truncate text-label text-muted-foreground">
              <span dir="auto">{branchLabel(project.locations)}</span>
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
          {canAuthor && (
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
              {involvedRoles.map((role) => t(roleLabelKey(role))).join(', ')}
            </Field>
            {/* The one place every branch is named. The card and the hero summarise past two,
                because they are one line wide; this row is the answer to "which two, exactly". */}
            <Field label={t('projects.branch')}>
              {project.locations.length === 0 ? (
                <span>{t('projects.chainWide')}</span>
              ) : (
                <span dir="auto">{project.locations.map((branch) => branch.name).join(', ')}</span>
              )}
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
          canTick={canTick}
          canAuthor={canAuthor}
          canAssign={canAssign}
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
  canTick,
  canAuthor,
  canAssign,
  onChanged,
}: {
  project: ProjectSummary
  items: ProjectChecklistItem[]
  // Move a line between done and not done: everyone the project reaches.
  canTick: boolean
  // Add a line, strike one out: the project's author alone.
  canAuthor: boolean
  // Put somebody's name on a line: its own capability, its own switch on the Access page.
  canAssign: boolean
  onChanged: () => void
}) {
  const t = useTranslations()
  const [title, setTitle] = useState('')
  const [failed, setFailed] = useState(false)

  // Asked for only when somebody can actually assign — most visits to a project page are here to
  // read the list or tick a line, and neither needs the branch's roster.
  const candidatesQuery = useQuery({
    queryKey: projectCandidatesKey(project.id),
    queryFn: () => projectsApi.assignable(project.id),
    enabled: canAssign,
  })
  const candidates = candidatesQuery.data?.candidates ?? []

  const assignMutation = useMutation({
    mutationFn: ({ itemId, userIds }: { itemId: string; userIds: string[] }) =>
      projectsApi.setChecklistItemAssignees(project.id, itemId, userIds),
    onSuccess: onChanged,
    onError: () => setFailed(true),
  })

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

  const busy =
    toggleMutation.isPending ||
    addMutation.isPending ||
    removeMutation.isPending ||
    assignMutation.isPending

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
          {canAuthor ? t('projects.noItems') : t('projects.noItemsReadOnly')}
        </p>
      ) : (
        <ul className="bb-stagger flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="group flex items-center gap-2.5 px-4 py-2.5">
              {/* A real checkbox, visually hidden inside its label: the gesture this list exists
                  for should be the browser's own control, not a button imitating one. */}
              <label
                className={cn(
                  'inline-grid size-5 flex-none place-items-center rounded-[4px] border transition',
                  item.done
                    ? 'border-transparent bg-status-done-dot text-white'
                    : 'border-border-strong text-transparent hover:border-foreground',
                  canTick ? 'cursor-pointer' : 'cursor-default opacity-70',
                  'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-card',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={item.done}
                  disabled={busy || !canTick}
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

              {/* Between the line and its delete: who is doing it sits with the line, and the way
                  to take the line away stays at the far edge where every other row's does. Left
                  out entirely rather than shown inert for somebody who cannot assign — an empty
                  seat that does nothing when pressed is worse than no seat. */}
              {canAssign && (
                <StepOwners
                  candidates={candidates}
                  picked={item.assignees.map((owner) => owner.id)}
                  label={t('projects.stepOwners')}
                  disabled={candidatesQuery.isPending}
                  busy={assignMutation.isPending}
                  onToggle={(id) => {
                    const current = item.assignees.map((owner) => owner.id)
                    assignMutation.mutate({
                      itemId: item.id,
                      userIds: current.includes(id)
                        ? current.filter((one) => one !== id)
                        : [...current, id],
                    })
                  }}
                />
              )}

              {/* Somebody who cannot assign still needs to see whose line it is — that is the
                  whole point of putting a name on it. The stack alone, with no control under it. */}
              {!canAssign && item.assignees.length > 0 && (
                <AvatarStack
                  names={item.assignees.map((owner) => owner.displayName)}
                  label={t('projects.stepOwners')}
                  max={3}
                  overflowLabel={t('projects.stepOwnerMore', {
                    count: Math.max(0, item.assignees.length - 3),
                  })}
                  // leading-none for the reason step-owners.tsx gives: the disc otherwise rides
                  // an inherited line box taller than itself and drops the row 5px.
                  className="flex-none leading-none"
                />
              )}

              {canAuthor && (
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

      {canAuthor && (
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
