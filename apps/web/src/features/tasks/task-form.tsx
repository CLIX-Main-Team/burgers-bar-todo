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
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { Select } from '../../components/ui/select.js'
import { taskPriorityLabelKey, taskStatusLabelKey } from '../../i18n/labels.js'
import { ApiError, tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The create / edit form for a task (#133, Slice B, stories 24-32). Rendered only for a manager or
// admin — the board never offers it to an employee — and, like every write surface, it mirrors what
// the acting principal may do so a user is never shown a choice the API will reject (ADR-0007): the
// assignee options are exactly the people at the task's own location (the assignee-location
// invariant the server enforces), and an admin, who holds no location of their own, picks the board
// first. The API stays the sole authority regardless: it re-derives the location from the principal
// and re-checks the invariant on every write.

interface TaskFormFields {
  title: string
  description: string
  priority: TaskPriority
  // The task's status, editable through the full-update path (#134, story 43). Only shown and sent on
  // edit — a new task always starts not_started server-side, so create never offers this.
  status: TaskStatus
  // An <input type="date"> value: 'YYYY-MM-DD', or '' for no due date.
  dueDate: string
  assigneeIds: string[]
  // The board an admin is creating on; unused for a manager (their own is implied) and for edit (a
  // task never moves location).
  locationId: string
}

interface TaskFormProps {
  mode: 'create' | 'edit'
  principal: PrincipalResponse
  // The already-scoped people list (GET /users): a manager's own location, an admin's whole chain.
  // The form narrows it to the task's location for the assignee choices.
  users: UserSummary[]
  // The task under edit; absent in create mode.
  task?: Task
  onClose(): void
}

export function TaskForm({ mode, principal, users, task, onClose }: TaskFormProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const isAdmin = principal.role === 'admin'

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
  // assignee in the list even if they are no longer an active location user, so a plain edit does not
  // silently drop them (they were already validated onto the task).
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

  // The boards an admin may create on, derived from the distinct locations in the already-scoped
  // people list (there is no separate locations endpoint) — the same source the people filter reads.
  const locationOptions = useMemo(
    () =>
      Array.from(
        new Set(users.map((user) => user.locationId).filter((id): id is string => id !== null)),
      ),
    [users],
  )

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
  const pending = createMutation.isPending || updateMutation.isPending

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
      // A manager/admin may move status through this full edit (#134, story 43); the employee's
      // status path is separate. Create never sends it — a new task always starts not_started.
      status: values.status,
    })
  })

  const rootError = form.formState.errors.root?.message

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm"
      onSubmit={onSubmit}
    >
      <h2 className="text-base font-semibold text-foreground">
        {t(mode === 'create' ? 'tasks.createHeading' : 'tasks.editHeading')}
      </h2>

      {rootError ? <Alert tone="error">{rootError}</Alert> : null}

      <Field label={t('tasks.fieldTitle')}>
        {(props) => (
          // dir="auto" so an authored title lays out by its own script — Hebrew RTL, English LTR.
          <Input dir="auto" {...props} {...form.register('title', { required: true })} />
        )}
      </Field>

      <Field label={t('tasks.fieldDescription')}>
        {(props) => (
          <textarea
            dir="auto"
            rows={3}
            className="flex w-full rounded-sm border border-input bg-background px-3 py-2 text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            {...props}
            {...form.register('description')}
          />
        )}
      </Field>

      {mode === 'create' && isAdmin ? (
        <Field label={t('tasks.fieldLocation')}>
          {(props) => {
            const location = form.register('locationId', { required: true })
            return (
              <Select
                {...props}
                {...location}
                onChange={(event) => {
                  // Switching boards invalidates people picked at the previous one, so clear the
                  // checked assignees; a stale cross-location id would be rejected by the invariant.
                  void location.onChange(event)
                  form.setValue('assigneeIds', [])
                }}
              >
                <option value="">{t('tasks.locationPlaceholder')}</option>
                {locationOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </Select>
            )
          }}
        </Field>
      ) : null}

      <Field label={t('tasks.fieldPriority')}>
        {(props) => (
          <Select {...props} {...form.register('priority')}>
            {(['low', 'normal', 'high'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {t(taskPriorityLabelKey(priority))}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {/* Status is settable only on edit (#134, story 43): a new task always starts not_started
          server-side, so create offers no status choice. */}
      {mode === 'edit' ? (
        <Field label={t('tasks.fieldStatus')}>
          {(props) => (
            <Select {...props} {...form.register('status')}>
              {taskStatusSchema.options.map((status) => (
                <option key={status} value={status}>
                  {t(taskStatusLabelKey(status))}
                </option>
              ))}
            </Select>
          )}
        </Field>
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
            <div className="flex flex-col gap-2">
              {assigneeCandidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className="flex items-center gap-2 text-sm text-foreground"
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
            {/* Leaving everyone unchecked is a legitimate choice — it keeps the task in the backlog. */}
            <p className="text-xs text-muted-foreground">{t('tasks.backlogHint')}</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('common.working') : t(mode === 'create' ? 'tasks.create' : 'tasks.save')}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
