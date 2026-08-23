import {
  type CreateProjectRequest,
  type PrincipalResponse,
  type ProjectColour,
  type ProjectIcon,
  type ProjectSummary,
  type UpdateProjectRequest,
  isChainAdmin,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Avatar } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { DateField } from '../../components/ui/date-field.js'
import { Dialog } from '../../components/ui/dialog.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { ApiError, projectsApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import {
  PROJECT_COLOURS,
  PROJECT_FILL,
  PROJECT_ICONS,
  PROJECT_ICON_LABEL_KEY,
  PROJECT_ICON_ROLE,
  PROJECT_TILE,
} from './project-look.js'
import { PROJECTS_QUERY_KEY } from './project-queries.js'

// The create / edit project dialog, built as the task dialog's sibling rather than as a new kind
// of surface: the same centred Dialog, the same big borderless name input leading it, the same
// one-column property grid of icon-label-control rows underneath, the same footer holding the two
// decisions and the destructive one on the far side. Somebody who has filed a task knows how to
// file a project without being taught twice.
//
// The one row the task dialog does not have is the identity picker, and it leads the grid because
// it is the only choice here that is purely a choice — everything below it is a fact about the
// work. It is a grid of real glyphs on real tone chips rather than two dropdowns of colour names,
// because you are picking what the card will LOOK like and the only honest preview of that is the
// thing itself.
//
// Like every write surface it mirrors what the acting principal may do, so nobody is offered a
// choice the API would reject (ADR-0007): a manager may file a project at their own branch or
// across the chain and nowhere else, and the branch row simply does not appear for them.

export interface ProjectFormValues {
  name: string
  icon: ProjectIcon
  colour: ProjectColour
  locationId: string | null
  leadId: string | null
  startDate: string
  targetDate: string
  phase: string
}

// A new project opens on the first icon and the first tone rather than on nothing, so the preview
// tile is never an empty square and the form is submittable the moment a name is typed.
function initialValues(project: ProjectSummary | null): ProjectFormValues {
  if (!project) {
    return {
      name: '',
      icon: 'menu',
      colour: 'amber',
      locationId: null,
      leadId: null,
      startDate: '',
      targetDate: '',
      phase: '',
    }
  }
  return {
    name: project.name,
    icon: project.icon,
    colour: project.colour,
    locationId: project.locationId,
    leadId: project.lead?.id ?? null,
    startDate: project.startDate ? project.startDate.slice(0, 10) : '',
    targetDate: project.targetDate ? project.targetDate.slice(0, 10) : '',
    phase: project.phase ?? '',
  }
}

// One body for both writes. The update contract is the stricter of the two (every field present,
// nullable where the column is) and the create contract accepts it plus a branch, so typing the
// payload this way means the form can only ever build a request both endpoints will take.
type ProjectPayload = UpdateProjectRequest & { locationId: string | null }

// A date field hands back 'YYYY-MM-DD'; the API takes an instant. Noon local rather than midnight,
// for the same reason the seed uses it: a date stamped at midnight lands on the previous day for
// anyone whose clock runs behind the server's, and a target date that reads one day early is worse
// than no target date at all.
function toInstant(day: string): string | null {
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return null
  return new Date(year, month - 1, date, 12, 0, 0).toISOString()
}

export function ProjectFormDialog({
  open,
  onClose,
  principal,
  project,
  people,
}: {
  open: boolean
  onClose: () => void
  principal: PrincipalResponse
  // Null is a create; a project is an edit of that project.
  project: ProjectSummary | null
  people: { id: string; displayName: string }[]
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [values, setValues] = useState<ProjectFormValues>(() => initialValues(project))
  const [failed, setFailed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Only an admin ever opens the branch row, so the list is fetched only for one.
  const locationsQuery = useLocations({ enabled: isChainAdmin(principal.role) })
  const chainAdmin = isChainAdmin(principal.role)
  const locations = locationsQuery.data ?? []

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }))

  const done = () => {
    queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
    onClose()
  }

  const saveMutation = useMutation({
    mutationFn: (body: ProjectPayload) =>
      project ? projectsApi.updateProject(project.id, body) : projectsApi.createProject(body),
    onSuccess: done,
    onError: (error) => setFailed(error instanceof ApiError),
  })

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.deleteProject(project?.id ?? ''),
    onSuccess: done,
    onError: () => setFailed(true),
  })

  const submit = () => {
    const name = values.name.trim()
    if (!name) return
    setFailed(false)
    saveMutation.mutate({
      name,
      icon: values.icon,
      colour: values.colour,
      // A manager's branch is resolved server-side; only an admin names one, and null is the
      // legitimate "across the chain" answer for both.
      locationId: chainAdmin ? values.locationId : null,
      leadId: values.leadId,
      startDate: toInstant(values.startDate),
      targetDate: toInstant(values.targetDate),
      phase: values.phase.trim() || null,
    })
  }

  const busy = saveMutation.isPending || deleteMutation.isPending
  const leadOptions: SelectOption[] = [
    { value: '', label: t('projects.noLead') },
    ...people.map((person) => ({
      value: person.id,
      label: person.displayName,
      lead: <Avatar name={person.displayName} className="size-5 text-[0.5rem]" />,
    })),
  ]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      hideTitle
      title={project ? t('projects.editProject') : t('projects.newProject')}
      className="max-w-[34rem]"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {/* The name leads, as the task dialog's title does: a project is its name, and a labelled
            row four lines down would say otherwise. The tile beside it previews the identity the
            grid below is choosing, so the choice is never abstract. */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-grid size-11 flex-none place-items-center rounded-xl',
              PROJECT_TILE[values.colour],
            )}
          >
            <Icon name={PROJECT_ICON_ROLE[values.icon]} size="lg" />
          </span>
          <Input
            id={nameId}
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder={t('projects.namePlaceholder')}
            aria-label={t('projects.name')}
            className="h-auto rounded-md border-0 bg-transparent px-1 py-1 text-heading-md font-bold shadow-none focus-visible:bg-muted focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        <div className="flex flex-col divide-y divide-border border-border border-y">
          <Row icon="folder" label={t('projects.identity')}>
            <div className="flex flex-col gap-2 py-1">
              {/* Twelve glyphs in one grid. Real radio inputs, visually hidden inside their
                  labels: the label carries the look, the input carries the semantics and the
                  keyboard's arrow-key walk, and focus-within paints the ring where the eye is. */}
              <fieldset className="grid w-fit grid-cols-6 gap-1.5">
                <legend className="sr-only">{t('projects.icon')}</legend>
                {PROJECT_ICONS.map((icon) => (
                  <label
                    key={icon}
                    title={t(PROJECT_ICON_LABEL_KEY[icon])}
                    className={cn(
                      'inline-grid size-8 cursor-pointer place-items-center rounded-lg border transition',
                      values.icon === icon
                        ? cn('border-transparent', PROJECT_TILE[values.colour])
                        : 'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
                      'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-card',
                    )}
                  >
                    <input
                      type="radio"
                      name="project-icon"
                      className="sr-only"
                      checked={values.icon === icon}
                      onChange={() => set('icon', icon)}
                      aria-label={t(PROJECT_ICON_LABEL_KEY[icon])}
                    />
                    <Icon name={PROJECT_ICON_ROLE[icon]} size="sm" />
                  </label>
                ))}
              </fieldset>
              {/* The tones. Each swatch is the colour itself and names itself to a screen reader,
                  so the choice is never made in colour alone. */}
              <fieldset className="flex flex-wrap gap-1.5">
                <legend className="sr-only">{t('projects.colour')}</legend>
                {PROJECT_COLOURS.map((colour) => (
                  <label
                    key={colour}
                    title={t(`projects.colour${colour[0]?.toUpperCase()}${colour.slice(1)}`)}
                    className={cn(
                      'size-6 cursor-pointer rounded-full transition',
                      PROJECT_FILL[colour],
                      values.colour === colour
                        ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card'
                        : 'hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-card',
                      'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card',
                    )}
                  >
                    <input
                      type="radio"
                      name="project-colour"
                      className="sr-only"
                      checked={values.colour === colour}
                      onChange={() => set('colour', colour)}
                      aria-label={t(`projects.colour${colour[0]?.toUpperCase()}${colour.slice(1)}`)}
                    />
                  </label>
                ))}
              </fieldset>
            </div>
          </Row>

          <Row icon="role" label={t('projects.lead')}>
            <Select
              value={values.leadId ?? ''}
              onValueChange={(value) => set('leadId', value || null)}
              options={leadOptions}
              label={t('projects.lead')}
              triggerClassName="border-0 bg-transparent px-1 shadow-none"
            />
          </Row>

          {/* Only an admin picks a branch. A manager's project lands on their own branch or across
              the chain, and the API resolves that from the principal — showing them a picker they
              could only get wrong would be the UI lying about what it can do. */}
          {chainAdmin && (
            <Row icon="location" label={t('projects.branch')}>
              <Select
                value={values.locationId ?? ''}
                onValueChange={(value) => set('locationId', value || null)}
                options={[
                  { value: '', label: t('projects.chainWide') },
                  ...locations.map((location) => ({ value: location.id, label: location.name })),
                ]}
                label={t('projects.branch')}
                triggerClassName="border-0 bg-transparent px-1 shadow-none"
              />
            </Row>
          )}

          <Row icon="due-date" label={t('projects.startDate')}>
            <DateField
              value={values.startDate}
              onChange={(next) => set('startDate', next)}
              label={t('projects.startDate')}
            />
          </Row>

          <Row icon="overdue" label={t('projects.fieldTarget')}>
            <DateField
              value={values.targetDate}
              onChange={(next) => set('targetDate', next)}
              label={t('projects.fieldTarget')}
            />
          </Row>

          <Row icon="status-in-progress" label={t('projects.phase')}>
            <Input
              value={values.phase}
              onChange={(event) => set('phase', event.target.value)}
              placeholder={t('projects.phasePlaceholder')}
              aria-label={t('projects.phase')}
              className="border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </Row>
        </div>

        {/* There is no progress control anywhere in this form, on purpose: progress is the task
            list, and a field that could disagree with it would only ever be the one that is wrong. */}
        <p className="text-caption text-muted-foreground">{t('projects.progressIsTasks')}</p>

        {failed && <Alert tone="error">{t('projects.saveFailed')}</Alert>}

        <div className="flex items-center justify-between gap-2.5">
          {project ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:bg-destructive/10"
            >
              <Icon name="delete" size="sm" />
              {t('projects.deleteProject')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2.5">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !values.name.trim()}>
              {busy ? t('common.working') : t('projects.saveProject')}
            </Button>
          </div>
        </div>
      </form>

      {/* The one thing worth spelling out before it happens: the tasks survive. Somebody deleting
          a project should not have to wonder whether they just deleted a month of work. */}
      <AlertDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        title={t('projects.deleteTitle', { name: project?.name ?? '' })}
        description={t('projects.deleteBody')}
        confirmLabel={t('projects.deleteProject')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Dialog>
  )
}

// One property row: a glyph, a quiet label, and the control. The same three-part shape the task
// dialog's grid uses, so the two forms scan identically.
function Row({
  icon,
  label,
  children,
}: {
  icon: IconRole
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="flex w-[7.5rem] flex-none items-center gap-2 pt-2 text-label text-muted-foreground">
        <Icon name={icon} size="sm" />
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
