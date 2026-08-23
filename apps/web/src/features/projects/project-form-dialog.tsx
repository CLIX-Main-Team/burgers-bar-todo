import {
  type PrincipalResponse,
  type ProjectColour,
  type ProjectIcon,
  type ProjectPhase,
  type ProjectRole,
  type ProjectSummary,
  type UpdateProjectRequest,
  isChainAdmin,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ButtonHTMLAttributes, type ReactNode, useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DateField } from '../../components/ui/date-field.js'
import { Dialog } from '../../components/ui/dialog.js'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
} from '../../components/ui/dropdown-menu.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, projectsApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useLocations } from '../locations/use-locations.js'
import {
  PROJECT_COLOURS,
  PROJECT_FILL,
  PROJECT_ICONS,
  PROJECT_ICON_LABEL_KEY,
  PROJECT_ICON_ROLE,
  PROJECT_PHASES,
  PROJECT_PHASE_LABEL_KEY,
  PROJECT_ROLES,
  PROJECT_ROLE_LABEL_KEY,
  PROJECT_TILE,
} from './project-look.js'
import { PROJECTS_QUERY_KEY } from './project-queries.js'

// The create / edit project dialog, built as the task dialog's sibling rather than as a new kind
// of surface: the same centred Dialog, the same big borderless name input leading it, the same
// one-column property grid of icon-label-control rows, the same footer holding the two decisions
// with the destructive one on the far side. Somebody who has filed a task knows how to file a
// project without being taught twice.
//
// Every control in the grid is a bare VALUE that highlights on hover and opens a menu — the task
// dialog's own idiom (owner call 2026-08-23: "it should just be like a hover similar to the task
// module"). There are no boxed selects here. A form where every row is a filled input box reads as
// a form to be completed; a form where every row is a value to be changed reads as a thing that
// already exists, which is what a project is by the time you are looking at it.
//
// Like every write surface it mirrors what the acting principal may do, so nobody is offered a
// choice the API would reject (ADR-0007): a manager may file a project at their own branch or
// across the chain and nowhere else, and the branch row simply does not appear for them.

export interface ProjectFormValues {
  name: string
  icon: ProjectIcon
  colour: ProjectColour
  roles: ProjectRole[]
  locationId: string | null
  startDate: string
  targetDate: string
  phase: ProjectPhase
}

function initialValues(project: ProjectSummary | null): ProjectFormValues {
  if (!project) {
    return {
      name: '',
      icon: 'menu',
      colour: 'amber',
      // Manager is the floor: a project has to be for somebody, and the person creating one is
      // almost always a manager describing work for themselves.
      roles: ['manager'],
      locationId: null,
      startDate: '',
      targetDate: '',
      phase: 'planning',
    }
  }
  return {
    name: project.name,
    icon: project.icon,
    colour: project.colour,
    roles: [...project.roles],
    locationId: project.locationId,
    startDate: project.startDate ? project.startDate.slice(0, 10) : '',
    targetDate: project.targetDate ? project.targetDate.slice(0, 10) : '',
    phase: project.phase,
  }
}

// A date field hands back 'YYYY-MM-DD'; the API takes an instant. Noon local rather than midnight:
// a date stamped at midnight lands on the previous day for anyone whose clock runs behind the
// server's, and a target date that reads one day early is worse than no target date at all.
function toInstant(day: string): string | null {
  if (!day) return null
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return null
  return new Date(year, month - 1, date, 12, 0, 0).toISOString()
}

type ProjectPayload = UpdateProjectRequest & { locationId: string | null; checklist: string[] }

export function ProjectFormDialog({
  open,
  onClose,
  principal,
  project,
}: {
  open: boolean
  onClose: () => void
  principal: PrincipalResponse
  // Null is a create; a project is an edit of that project.
  project: ProjectSummary | null
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const nameId = useId()
  const [values, setValues] = useState<ProjectFormValues>(() => initialValues(project))
  // The checklist typed while describing the project. Create only — once a project exists its
  // checklist is edited on its own page, where the ticking happens.
  const [checklist, setChecklist] = useState<string[]>([])
  const [draftItem, setDraftItem] = useState('')
  const [failed, setFailed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const chainAdmin = isChainAdmin(principal.role)
  const locationsQuery = useLocations({ enabled: chainAdmin })
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

  const addDraftItem = () => {
    const next = draftItem.trim()
    if (!next) return
    setChecklist((prev) => [...prev, next])
    setDraftItem('')
  }

  const submit = () => {
    const name = values.name.trim()
    if (!name || values.roles.length === 0) return
    setFailed(false)
    // A line half-typed in the checklist field is work somebody meant to add, so it goes in rather
    // than being silently dropped on submit.
    const pending = draftItem.trim()
    saveMutation.mutate({
      name,
      icon: values.icon,
      colour: values.colour,
      roles: values.roles,
      // A manager's branch is resolved server-side; only an admin names one, and null is the
      // legitimate "across the chain" answer for both.
      locationId: chainAdmin ? values.locationId : null,
      startDate: toInstant(values.startDate),
      targetDate: toInstant(values.targetDate),
      phase: values.phase,
      checklist: pending ? [...checklist, pending] : checklist,
    })
  }

  const busy = saveMutation.isPending || deleteMutation.isPending
  const chosenRoles = PROJECT_ROLES.filter((role) => values.roles.includes(role))

  return (
    <Dialog
      open={open}
      onClose={onClose}
      hideTitle
      title={project ? t('projects.editProject') : t('projects.newProject')}
      className="max-w-[34rem]"
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {/* The name leads, as the task dialog's title does. `pe-9` is load-bearing rather than
            cosmetic: the dialog's close button is absolutely positioned in this corner, and
            without the reserved gutter a long name runs underneath the X. */}
        <div className="flex items-center gap-3 pe-9">
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
            <div className="flex flex-col gap-2.5 py-1.5">
              {/* Twelve glyphs over six tones, in one 6-column grid so the two rows line up with
                  the swatches under them. Real radio inputs, visually hidden inside their labels:
                  the label carries the look, the input carries the semantics and the keyboard's
                  arrow-key walk, and focus-within paints the ring where the eye is. */}
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

          {/* Who the project is for. This is not a label: the roles named here decide who can open
              the project at all, which is why the row says so under the value rather than leaving
              somebody to find out by being asked why an employee cannot see it. */}
          <Row icon="role" label={t('projects.forRoles')}>
            <DropdownMenu
              label={t('projects.forRoles')}
              align="start"
              trigger={(props) => (
                <ValueTrigger
                  {...props}
                  aria-label={t('projects.forRoles')}
                  muted={chosenRoles.length === 0}
                >
                  {chosenRoles.length === 0
                    ? t('projects.pickRoles')
                    : chosenRoles.map((role) => t(PROJECT_ROLE_LABEL_KEY[role])).join(', ')}
                </ValueTrigger>
              )}
            >
              <div className="py-1">
                {PROJECT_ROLES.map((role) => (
                  <DropdownMenuCheckboxItem
                    key={role}
                    checked={values.roles.includes(role)}
                    onToggle={() =>
                      set(
                        'roles',
                        values.roles.includes(role)
                          ? values.roles.filter((one) => one !== role)
                          : [...values.roles, role],
                      )
                    }
                  >
                    {t(PROJECT_ROLE_LABEL_KEY[role])}
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
            </DropdownMenu>
            <p className="mt-0.5 px-1 text-caption text-muted-foreground">
              {t('projects.forRolesHint')}
            </p>
          </Row>

          {chainAdmin && (
            <Row icon="location" label={t('projects.branch')}>
              <DropdownMenu
                label={t('projects.branch')}
                align="start"
                trigger={(props) => (
                  <ValueTrigger {...props} aria-label={t('projects.branch')}>
                    {locations.find((one) => one.id === values.locationId)?.name ??
                      t('projects.chainWide')}
                  </ValueTrigger>
                )}
              >
                <div className="py-1">
                  <DropdownMenuRadioItem
                    checked={values.locationId === null}
                    onSelect={() => set('locationId', null)}
                    hideCheck
                  >
                    {t('projects.chainWide')}
                  </DropdownMenuRadioItem>
                  {locations.map((location) => (
                    <DropdownMenuRadioItem
                      key={location.id}
                      checked={values.locationId === location.id}
                      onSelect={() => set('locationId', location.id)}
                      hideCheck
                    >
                      {location.name}
                    </DropdownMenuRadioItem>
                  ))}
                </div>
              </DropdownMenu>
            </Row>
          )}

          <Row icon="status-in-progress" label={t('projects.phase')}>
            <DropdownMenu
              label={t('projects.phase')}
              align="start"
              trigger={(props) => (
                <ValueTrigger {...props} aria-label={t('projects.phase')}>
                  {t(PROJECT_PHASE_LABEL_KEY[values.phase])}
                </ValueTrigger>
              )}
            >
              <div className="py-1">
                {PROJECT_PHASES.map((phase) => (
                  <DropdownMenuRadioItem
                    key={phase}
                    checked={values.phase === phase}
                    onSelect={() => set('phase', phase)}
                    hideCheck
                  >
                    {t(PROJECT_PHASE_LABEL_KEY[phase])}
                  </DropdownMenuRadioItem>
                ))}
              </div>
            </DropdownMenu>
          </Row>

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
        </div>

        {/* The checklist, written while the project is still being described — somebody planning a
            rollout types the steps as they think of them, not on a second screen afterwards.
            Create only: once a project exists its checklist is edited on its own page, where the
            ticking happens and where the phase closes itself. */}
        {!project && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2.5">
              <span className="flex items-center gap-2 text-label font-semibold text-foreground">
                <Icon name="tasks" size="sm" className="text-muted-foreground" />
                {t('projects.checklist')}
              </span>
              {checklist.length > 0 && (
                <span className="text-caption tabular-nums text-muted-foreground">
                  {t('projects.checklistCount', { count: checklist.length })}
                </span>
              )}
            </div>

            {checklist.length > 0 && (
              <ul className="flex flex-col gap-1">
                {checklist.map((item, index) => (
                  <li
                    // Plain strings in a list somebody is still typing, and the same line can
                    // legitimately appear twice, so the slot is the identity.
                    // biome-ignore lint/suspicious/noArrayIndexKey: draft strings may repeat; position is the identity.
                    key={`${item}-${index}`}
                    className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5"
                  >
                    <span
                      aria-hidden
                      className="size-4 flex-none rounded-[4px] border border-border-strong"
                    />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-body">
                      {item}
                    </span>
                    <button
                      type="button"
                      aria-label={t('projects.removeItem', { title: item })}
                      onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== index))}
                      className="flex-none rounded-md p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon name="close" size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2">
              <Input
                value={draftItem}
                onChange={(event) => setDraftItem(event.target.value)}
                // Enter adds a line instead of submitting the form: this field is a list builder,
                // and somebody typing five steps should not have to reach for the mouse between
                // each one.
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addDraftItem()
                  }
                }}
                placeholder={t('projects.addItemPlaceholder')}
                aria-label={t('projects.addItem')}
                className="h-9"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addDraftItem}
                disabled={!draftItem.trim()}
                className="flex-none"
              >
                {t('projects.addItem')}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              {t('projects.progressIsChecklist')}
            </p>
          </div>
        )}

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
            <Button
              type="submit"
              disabled={busy || !values.name.trim() || values.roles.length === 0}
            >
              {busy ? t('common.working') : t('projects.saveProject')}
            </Button>
          </div>
        </div>
      </form>

      {/* The one thing worth spelling out before it happens: somebody deleting a project should not
          have to wonder what else went with it. */}
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
function Row({ icon, label, children }: { icon: IconRole; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="flex w-[7.5rem] flex-none items-center gap-2 pt-1.5 text-label text-muted-foreground">
        <Icon name={icon} size="sm" />
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// The one trigger shape every menu row in this form wears: a bare value that highlights on hover,
// not a boxed select. Borrowed verbatim from the task dialog's assignee control (owner call
// 2026-08-23) so the two forms are the same object in two places.
function ValueTrigger({
  children,
  muted,
  ...props
}: { children: ReactNode; muted?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-start text-body font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span dir="auto" className="min-w-0 flex-1 truncate">
        {children}
      </span>
      <Icon name="disclosure" size="sm" className="flex-none text-muted-foreground" />
    </button>
  )
}
