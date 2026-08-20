import {
  type CreateTaskRequest,
  type PrincipalResponse,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskRequest,
  type UserSummary,
  isChainAdmin,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { Textarea } from '../../components/ui/textarea.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { ApiError, tasksApi } from '../../lib/api.js'
import { useLocations } from '../locations/use-locations.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The create / edit task dialog (#133/#134), recut to v2 (round 10) from the drawer it used
// to be. The change is what the surface leads with: a task is its title, so the title is now
// a large borderless input at the top of the card rather than the fourth labelled row down,
// and everything that describes the task — status, priority, due date, branch — sits under
// it as one compact property grid, each row an icon, a quiet label, and the control itself.
// The description follows below a rule, and the footer holds the two decisions.
//
// It is a centred Dialog now, not the inline-end Sheet: the drawer's shape said "a panel
// beside the board", which was never true of a form that owns the screen while it is open.
// The Dialog's own heading is hidden (`hideTitle`) but still announced, because the title
// input directly under it would otherwise say the same word twice.
//
// Everything behind the glass is unchanged. Rendered only for a manager or admin, and, like
// every write surface, it mirrors what the acting principal may do so a user is never shown
// a choice the API will reject (ADR-0007): the assignee options are exactly the active people
// at the task's own location, and an admin, who holds no location of their own, picks the
// board first (switching it clears the picked assignees, the assignee-location invariant).
// The API stays the sole authority regardless: it re-derives the location from the principal
// and re-checks the invariant on every write.

interface TaskFormFields {
  title: string
  description: string
  priority: TaskPriority
  // The task's status, editable through the full-update path (#134). Only shown and sent on edit
  // — a new task always starts not_started server-side, so create never offers this.
  status: TaskStatus
  // An <input type="date"> value: 'YYYY-MM-DD', or '' for no due date.
  dueDate: string
  assigneeIds: string[]
  // The board an admin is creating on; unused for a manager (their own is implied) and for edit (a
  // task never moves location).
  locationId: string
}

interface TaskFormDialogProps {
  mode: 'create' | 'edit'
  principal: PrincipalResponse
  // The already-scoped people list (GET /users): a manager's own location, an admin's whole chain.
  // The form narrows it to the task's location for the assignee choices.
  users: UserSummary[]
  // The task under edit; absent in create mode.
  task?: Task
  onClose(): void
}

// The compact trigger every property control wears inside the grid: no border, no fill, the
// value carrying full ink. The row's own label is the border here, so a boxed control would
// draw four lines around something already framed by the grid.
const BARE_CONTROL = 'h-8 rounded-md border-0 bg-transparent px-1 text-body font-medium shadow-none'

// One row of the property grid: the icon and label name the property, the control sets it.
// The label column is fixed so the controls line up down both columns of the grid.
function PropertyRow({
  icon,
  label,
  htmlFor,
  children,
}: { icon: IconRole; label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[38px] grid-cols-[6.625rem_minmax(0,1fr)] items-center gap-2.5">
      {/* A plain <span> when the control is not a single labelable element (the status chip
          is a menu button, the assignee block a group), so the label never points nowhere. */}
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="inline-flex items-center gap-[7px] text-label text-muted-foreground"
        >
          <Icon name={icon} size="sm" />
          {label}
        </label>
      ) : (
        <span className="inline-flex items-center gap-[7px] text-label text-muted-foreground">
          <Icon name={icon} size="sm" />
          {label}
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function TaskFormDialog({ mode, principal, users, task, onClose }: TaskFormDialogProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const isAdmin = isChainAdmin(principal.role)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const form = useForm<TaskFormFields>({
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      priority: task?.priority ?? 'normal',
      status: task?.status ?? 'not_started',
      // The stored due date is an ISO timestamp; the date input wants the calendar day alone.
      dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '',
      assigneeIds: task?.assignees.map((assignee) => assignee.id) ?? [],
      locationId: task?.locationId ?? (isAdmin ? '' : (principal.locationId ?? '')),
    },
  })

  // The priority options, labelled in the active language, in the order a person picks from:
  // the default first, then the one that changes a shift, then the one that defers it.
  const priorityOptions: SelectOption[] = useMemo(
    () =>
      (['normal', 'high', 'low'] as const).map((priority) => ({
        value: priority,
        label: t(taskPriorityLabelKey(priority)),
      })),
    [t],
  )

  // The location the assignee choices are drawn from: fixed to the task's own location on edit and
  // for a manager (their location); an admin picks it, so it follows the chosen board.
  const watchedLocationId = form.watch('locationId')
  const targetLocationId =
    mode === 'edit'
      ? (task?.locationId ?? '')
      : isAdmin
        ? watchedLocationId
        : (principal.locationId ?? '')

  // The people who may be assigned: active users at the task's location. On edit, keep any current
  // assignee in the list even if they are no longer an active location user, so a plain edit does
  // not silently drop them (they were already validated onto the task).
  const assigneeCandidates = useMemo(() => {
    const activeAtLocation = users
      .filter((user) => user.status === 'active' && user.locationId === targetLocationId)
      .map((user) => ({ id: user.id, displayName: user.displayName }))
    if (mode === 'edit' && task) {
      const known = new Set(activeAtLocation.map((candidate) => candidate.id))
      const stillAssigned = task.assignees.filter((assignee) => !known.has(assignee.id))
      return [...activeAtLocation, ...stillAssigned]
    }
    return activeAtLocation
  }, [users, targetLocationId, mode, task])

  // The boards an admin may create on, read from the authoritative Location list (GET /locations,
  // #164) rather than the distinct locations in the people list — so an admin can create the first
  // task on a brand-new, unstaffed branch. Admin-only server-side; on an admin's create form it
  // feeds the board picker, and on their edit dialog it resolves the task's own board to a name for
  // the provenance line (a task never changes location in v1, so edit shows it, never picks it).
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locationOptions: SelectOption[] = (locationsQuery.data ?? []).map((location) => ({
    value: location.id,
    label: location.name,
  }))
  // The edited task's branch name for the admin provenance line; null while loading or for the
  // non-admin viewers whose location is implicit, so the line simply doesn't render.
  const editedLocationName =
    isAdmin && mode === 'edit' && task
      ? (locationsQuery.data?.find((location) => location.id === task.locationId)?.name ?? null)
      : null

  const onSuccess = async (): Promise<void> => {
    // Refetch the acting user's board so their own view reflects the write at once; other viewers
    // get it over the live channel. The board query has refetchOnWindowFocus off, so this explicit
    // invalidation is what refreshes it.
    await queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    onClose()
  }
  const onError = (error: unknown): void => {
    if (error instanceof ApiError && error.status === 403) {
      form.setError('root', { message: t('tasks.writeForbidden') })
      return
    }
    form.setError('root', { message: t('tasks.writeFailed') })
  }

  const createMutation = useMutation({
    mutationFn: (body: CreateTaskRequest) => tasksApi.createTask(body),
    onSuccess,
    onError,
  })
  const updateMutation = useMutation({
    mutationFn: (body: UpdateTaskRequest) => tasksApi.updateTask(task?.id ?? '', body),
    onSuccess,
    onError,
  })
  const deleteMutation = useMutation({
    mutationFn: () => tasksApi.deleteTask(task?.id ?? ''),
    onSuccess,
    onError: () => {
      setConfirmingDelete(false)
      form.setError('root', { message: t('tasks.deleteFailed') })
    },
  })
  const pending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  const onSubmit = form.handleSubmit((values) => {
    form.clearErrors('root')
    // An empty note is stored as null, never a blank string; the due date rides the wire as an ISO
    // timestamp at the start of the chosen day.
    const description = values.description.trim() === '' ? null : values.description.trim()
    const dueDate = values.dueDate === '' ? null : new Date(values.dueDate).toISOString()

    if (mode === 'create') {
      createMutation.mutate({
        title: values.title,
        description,
        priority: values.priority,
        dueDate,
        assigneeIds: values.assigneeIds,
        // A manager sends no location — the API uses their own; an admin sends the chosen board.
        locationId: isAdmin ? values.locationId : null,
      })
      return
    }
    updateMutation.mutate({
      title: values.title,
      description,
      priority: values.priority,
      dueDate,
      assigneeIds: values.assigneeIds,
      // A manager/admin may move status through this full edit (#134); the employee's status path
      // is separate. Create never sends it — a new task always starts not_started.
      status: values.status,
    })
  })

  const rootError = form.formState.errors.root?.message
  const heading = t(mode === 'create' ? 'tasks.createHeading' : 'tasks.editHeading')

  return (
    <Dialog open onClose={onClose} title={heading} hideTitle className="max-w-[40rem]">
      <form className="flex flex-col gap-3.5" onSubmit={onSubmit}>
        {/* The task IS its title, so the title leads and wears the dialog's own heading size.
            dir="auto" so an authored title lays out by its own script — Hebrew RTL, English
            LTR. The visible heading is hidden above, so this input carries the aria-label. */}
        <Input
          dir="auto"
          aria-label={t('tasks.fieldTitle')}
          placeholder={t('tasks.titlePlaceholder')}
          className="h-auto border-0 bg-transparent px-0 text-heading-md font-bold shadow-none"
          {...form.register('title', { required: true })}
        />

        {rootError ? <Alert tone="error">{rootError}</Alert> : null}

        {/* The property grid: two columns on a desktop dialog, one on a phone where 106px of
            label plus a control will not sit twice across the width. */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {/* Status is settable only on edit (#134): a new task always starts not_started
              server-side, so create offers no status choice. It wears the board's own
              StatusControl chip rather than a select, so setting status is the same gesture
              and the same object here as on a card and in the list. */}
          {mode === 'edit' ? (
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <PropertyRow icon="status-not-started" label={t('tasks.fieldStatus')}>
                  <StatusControl
                    status={field.value}
                    onSelect={field.onChange}
                    label={t('tasks.fieldStatus')}
                    disabled={pending}
                  />
                </PropertyRow>
              )}
            />
          ) : null}

          <Controller
            control={form.control}
            name="priority"
            render={({ field }) => (
              <PropertyRow icon="priority-high" label={t('tasks.fieldPriority')}>
                <Select
                  label={t('tasks.fieldPriority')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={priorityOptions}
                  triggerClassName={BARE_CONTROL}
                />
              </PropertyRow>
            )}
          />

          <PropertyRow icon="due-date" label={t('tasks.fieldDueDate')} htmlFor="task-due-date">
            <Input
              id="task-due-date"
              type="date"
              className={`${BARE_CONTROL} w-auto`}
              {...form.register('dueDate')}
            />
          </PropertyRow>

          {/* The board an admin creates on, from the authoritative Location list. Loading and a
              load failure are surfaced plainly rather than collapsing to a bare placeholder the
              required rule would then silently block. */}
          {mode === 'create' && isAdmin ? (
            <PropertyRow icon="location" label={t('tasks.fieldLocation')}>
              {locationsQuery.isPending ? (
                <p className="text-label text-muted-foreground">{t('common.working')}</p>
              ) : locationsQuery.isError ? (
                <p className="text-label text-destructive">{t('tasks.locationsLoadFailed')}</p>
              ) : (
                <Controller
                  control={form.control}
                  name="locationId"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <Select
                      label={t('tasks.fieldLocation')}
                      placeholder={t('tasks.locationPlaceholder')}
                      value={field.value}
                      // Switching boards invalidates people picked at the previous one, so clear
                      // the checked assignees; a stale cross-location id is rejected by the
                      // invariant.
                      onValueChange={(value) => {
                        field.onChange(value)
                        form.setValue('assigneeIds', [])
                      }}
                      options={locationOptions}
                      triggerClassName={BARE_CONTROL}
                    />
                  )}
                />
              )}
            </PropertyRow>
          ) : null}

          {/* Provenance (#258): who created this task, read-only on edit. It belongs in the
              grid rather than above the title — it describes the task like every other row
              here, and it is the one row nobody sets. For an admin, whose board mixes every
              location, the task's branch rides alongside: a task never changes location in
              v1, so it would otherwise be unnameable from this dialog. */}
          {mode === 'edit' && task ? (
            <PropertyRow icon="account" label={t('tasks.fieldCreatedBy')}>
              <p dir="auto" className="truncate text-label text-foreground">
                {task.createdBy.displayName}
                {editedLocationName ? ` · ${editedLocationName}` : ''}
              </p>
            </PropertyRow>
          ) : null}
        </div>

        <div aria-hidden="true" className="h-px bg-border" />

        <Textarea
          dir="auto"
          rows={4}
          aria-label={t('tasks.fieldDescription')}
          placeholder={t('tasks.descriptionPlaceholder')}
          className="max-h-40 border-0 bg-transparent px-0 shadow-none"
          {...form.register('description')}
        />

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-label font-semibold text-muted-foreground">
            {t('tasks.fieldAssignees')}
          </legend>
          {assigneeCandidates.length === 0 ? (
            <p className="text-body text-muted-foreground">{t('tasks.assigneesEmpty')}</p>
          ) : (
            <>
              {/* Several people can carry one task, so this stays a multiple choice — the
                  v2 artboard's single assignee select would have quietly dropped a feature
                  the board already draws as a stack of faces. */}
              <div className="flex flex-wrap gap-x-4">
                {assigneeCandidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex min-h-11 cursor-pointer items-center gap-2 text-body text-foreground"
                  >
                    <input
                      type="checkbox"
                      value={candidate.id}
                      className="size-4 accent-primary"
                      {...form.register('assigneeIds')}
                    />
                    <span dir="auto">{candidate.displayName}</span>
                  </label>
                ))}
              </div>
              {/* Leaving everyone unchecked is legitimate — it keeps the task in the backlog. */}
              <p className="text-caption text-muted-foreground">{t('tasks.backlogHint')}</p>
            </>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
          {/* Edit adds a quiet destructive Delete pushed to the inline-start, routing its
              confirmation through the AlertDialog rather than deleting on the tap. */}
          {mode === 'edit' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="me-auto text-destructive hover:text-destructive focus-visible:text-destructive"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="delete" size="sm" />
              {t('tasks.delete')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('common.working') : t(mode === 'create' ? 'tasks.create' : 'tasks.save')}
          </Button>
        </div>
      </form>

      <AlertDialog
        open={confirmingDelete}
        title={t('tasks.confirmDelete')}
        confirmLabel={t('tasks.delete')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Dialog>
  )
}
