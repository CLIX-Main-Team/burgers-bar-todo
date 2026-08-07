import {
  type CreateTaskRequest,
  type PrincipalResponse,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskRequest,
  type UserSummary,
  taskStatusSchema,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { Sheet } from '../../components/ui/sheet.js'
import { Textarea } from '../../components/ui/textarea.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { ApiError, tasksApi } from '../../lib/api.js'
import { useLocations } from '../locations/use-locations.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The create / edit form (#133/#134), now the responsive TaskFormSheet the flagship board opens
// (#215, task-board mockup §Create/edit sheet, components.md §TaskFormSheet). It rides the Sheet
// primitive — a bottom sheet on mobile, an inline-end drawer over the board on desktop — and
// carries the same form the old inline card did, recomposed onto the DS primitives the mockup
// calls for: the description as a Textarea, and priority / status / location as the DS listbox
// Select (fixing audit X5's raw `<select>`s). Delete moves into the footer, routed through the
// same AlertDialog Slice A built.
//
// Rendered only for a manager or admin — the board never offers it to an employee — and, like
// every write surface, it mirrors what the acting principal may do so a user is never shown a
// choice the API will reject (ADR-0007): the assignee options are exactly the active people at
// the task's own location, and an admin, who holds no location of their own, picks the board
// first (switching it clears the picked assignees, the assignee-location invariant). The API
// stays the sole authority regardless: it re-derives the location from the principal and
// re-checks the invariant on every write.

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

interface TaskFormSheetProps {
  mode: 'create' | 'edit'
  principal: PrincipalResponse
  // The already-scoped people list (GET /users): a manager's own location, an admin's whole chain.
  // The form narrows it to the task's location for the assignee choices.
  users: UserSummary[]
  // The task under edit; absent in create mode.
  task?: Task
  onClose(): void
}

export function TaskFormSheet({ mode, principal, users, task, onClose }: TaskFormSheetProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const isAdmin = principal.role === 'admin'
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

  // The priority and status options, labelled in the active language. Status follows the enum's
  // own order so the sheet reads the same three-way choice the card's Move-to menu does.
  const priorityOptions: SelectOption[] = useMemo(
    () =>
      (['low', 'normal', 'high'] as const).map((priority) => ({
        value: priority,
        label: t(taskPriorityLabelKey(priority)),
      })),
    [t],
  )
  const statusOptions: SelectOption[] = useMemo(
    () =>
      taskStatusSchema.options.map((status) => ({
        value: status,
        label: t(taskStatusLabelKey(status)),
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
  // task on a brand-new, unstaffed branch. Admin-only server-side and only offered on an admin's
  // create form, so the query is gated to that case.
  const locationsQuery = useLocations({ enabled: isAdmin && mode === 'create' })
  const locationOptions: SelectOption[] = (locationsQuery.data ?? []).map((location) => ({
    value: location.id,
    label: location.name,
  }))

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
    <Sheet open onClose={onClose} title={heading}>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        {/* Provenance (#258): who created this task, shown read-only on edit — the detail surface
            the owner chose over a line on every board card. dir="auto" so a Hebrew name reads
            correctly inside an English sheet and the reverse. */}
        {mode === 'edit' && task ? (
          <p dir="auto" className="text-sm text-muted-foreground">
            {t('tasks.createdBy', { name: task.createdBy.displayName })}
          </p>
        ) : null}

        {rootError ? <Alert tone="error">{rootError}</Alert> : null}

        <Field label={t('tasks.fieldTitle')}>
          {(props) => (
            // dir="auto" so an authored title lays out by its own script — Hebrew RTL, English LTR.
            <Input dir="auto" {...props} {...form.register('title', { required: true })} />
          )}
        </Field>

        <Field label={t('tasks.fieldDescription')}>
          {(props) => (
            <Textarea
              dir="auto"
              rows={3}
              className="max-h-40"
              {...props}
              {...form.register('description')}
            />
          )}
        </Field>

        {/* The board an admin creates on, from the authoritative Location list. Loading and a load
            failure are surfaced plainly rather than collapsing to a bare placeholder the required
            rule would then silently block. */}
        {mode === 'create' && isAdmin ? (
          locationsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">{t('common.working')}</p>
          ) : locationsQuery.isError ? (
            <Alert tone="error">{t('tasks.locationsLoadFailed')}</Alert>
          ) : (
            <Controller
              control={form.control}
              name="locationId"
              rules={{ required: true }}
              render={({ field }) => (
                <Field label={t('tasks.fieldLocation')}>
                  {(props) => (
                    <Select
                      {...props}
                      label={t('tasks.fieldLocation')}
                      placeholder={t('tasks.locationPlaceholder')}
                      value={field.value}
                      // Switching boards invalidates people picked at the previous one, so clear
                      // the checked assignees; a stale cross-location id is rejected by the invariant.
                      onValueChange={(value) => {
                        field.onChange(value)
                        form.setValue('assigneeIds', [])
                      }}
                      options={locationOptions}
                    />
                  )}
                </Field>
              )}
            />
          )
        ) : null}

        <Controller
          control={form.control}
          name="priority"
          render={({ field }) => (
            <Field label={t('tasks.fieldPriority')}>
              {(props) => (
                <Select
                  {...props}
                  label={t('tasks.fieldPriority')}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={priorityOptions}
                />
              )}
            </Field>
          )}
        />

        {/* Status is settable only on edit (#134): a new task always starts not_started
            server-side, so create offers no status choice. */}
        {mode === 'edit' ? (
          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <Field label={t('tasks.fieldStatus')}>
                {(props) => (
                  <Select
                    {...props}
                    label={t('tasks.fieldStatus')}
                    value={field.value}
                    onValueChange={field.onChange}
                    options={statusOptions}
                  />
                )}
              </Field>
            )}
          />
        ) : null}

        <Field label={t('tasks.fieldDueDate')}>
          {(props) => <Input type="date" {...props} {...form.register('dueDate')} />}
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{t('tasks.fieldAssignees')}</p>
          {assigneeCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tasks.assigneesEmpty')}</p>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                {assigneeCandidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex min-h-11 items-center gap-2 text-base text-foreground"
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
              <p className="text-xs text-muted-foreground">{t('tasks.backlogHint')}</p>
            </>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t('common.working') : t(mode === 'create' ? 'tasks.create' : 'tasks.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {t('common.cancel')}
          </Button>
          {/* Edit adds a quiet destructive-outline Delete pushed to the inline-end, routing its
              confirmation through the AlertDialog rather than deleting on the tap. */}
          {mode === 'edit' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto text-destructive hover:text-destructive focus-visible:text-destructive"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              <Icon name="delete" size="sm" />
              {t('tasks.delete')}
            </Button>
          ) : null}
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
    </Sheet>
  )
}
