import type { Task } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { AvatarStack } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { StatusControl } from '../../components/ui/status-control.js'
import { taskPriorityLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { useDeferredClose } from '../../lib/use-exit-transition.js'
import { STATUS_ICON } from './board-columns.js'
import { TASKS_QUERY_KEY } from './board-stream.js'
import { PRIORITY_INK } from './priority.js'
import { useAllSubjects } from './subject-queries.js'
import { useTaskStatusMutation } from './task-menu.js'

// The task sheet for somebody who may not edit it (owner ask 2026-09-22: "at least make them
// see the modal"). An employee's card carried the title, the due date and a status pill, and
// nothing else: the description, the subject, who else is on it and the checklist all lived in
// the editor, which their role never opens. This is that editor's shape with every field read as
// a value rather than set as a control, so a task reads the same wherever it is opened.
//
// Two things on it still write, because they are the two writes the role holds and the card
// already offers one of them: the status pill (their lane move) and the checklist ticks (an
// assignee may tick a step, task-write-service.toggleChecklistItem). Everything else is text.
export function TaskViewDialog({
  task,
  locationName,
  onClose,
}: {
  task: Task
  // The branch's name when the reader's board spans more than one; their own is implied.
  locationName?: string
  onClose: () => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { open, close } = useDeferredClose(onClose)
  const queryClient = useQueryClient()
  const subjectsQuery = useAllSubjects()
  const subject = subjectsQuery.data?.find((row) => row.id === task.subjectId) ?? null
  const move = useTaskStatusMutation(task.id)
  const tick = useMutation({
    mutationFn: (input: { itemId: string; done: boolean }) =>
      tasksApi.toggleChecklistItem(task.id, input.itemId, input.done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
  })

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  const formatStamp = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(iso),
    )
  const done = task.checklist.filter((item) => item.done).length

  return (
    <Dialog open={open} onClose={close} title={task.title} hideTitle className="max-w-[40rem]">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col items-start gap-2 pe-9">
          <span className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {t('tasks.viewHeading')}
          </span>
        </div>

        {/* The title at the editor's own size and weight, so the sheet reads as the same
            surface; dir="auto" for an authored Hebrew title inside an English UI, on a box sized
            to the title so it starts where the rows under it start. */}
        <h2
          dir="auto"
          className="w-fit max-w-full px-2.5 text-heading-lg font-extrabold text-foreground"
        >
          {task.title}
        </h2>

        <div className="grid grid-cols-1 gap-y-0.5">
          <PropertyRow icon={STATUS_ICON[task.status]} label={t('tasks.fieldStatus')}>
            <StatusControl
              status={task.status}
              disabled={move.isPending}
              onSelect={(status) => move.mutate(status)}
              label={t('tasks.changeStatus', { title: task.title })}
            />
            {move.isError ? (
              <p className="mt-1 text-caption text-destructive">{t('tasks.statusFailed')}</p>
            ) : null}
          </PropertyRow>

          <PropertyRow icon="priority" label={t('tasks.fieldPriority')}>
            <Value>
              <Icon
                name="priority"
                size="sm"
                active={task.priority === 'high'}
                className={cn('flex-none', PRIORITY_INK[task.priority])}
              />
              {t(taskPriorityLabelKey(task.priority))}
            </Value>
          </PropertyRow>

          <PropertyRow icon="due-date" label={t('tasks.fieldDueDate')}>
            <Value muted={!task.dueDate}>
              {task.dueDate ? formatDate(task.dueDate) : t('tasks.viewNoDueDate')}
            </Value>
          </PropertyRow>

          <PropertyRow icon="account" label={t('tasks.fieldAssignees')}>
            {task.assignees.length === 0 ? (
              <Value muted>{t('tasks.filterBacklog')}</Value>
            ) : (
              <div className="flex min-h-8 min-w-0 items-center gap-2">
                <AvatarStack people={task.assignees} label={t('tasks.assignedTo')} />
                <span dir="auto" className="min-w-0 truncate text-body font-semibold">
                  {task.assignees.map((person) => person.displayName).join(', ')}
                </span>
              </div>
            )}
          </PropertyRow>

          {subject ? (
            <PropertyRow icon="folder" label={t('tasks.fieldSubject')}>
              <Value>
                <span dir="auto">{subject.name}</span>
              </Value>
            </PropertyRow>
          ) : null}

          {locationName ? (
            <PropertyRow icon="location" label={t('tasks.fieldLocation')}>
              <Value>
                <span dir="auto">{locationName}</span>
              </Value>
            </PropertyRow>
          ) : null}
        </div>

        {/* The description as written, line breaks kept: it is the one place the task explains
            itself, and the whole reason this sheet exists for a reader. */}
        <section className="flex flex-col gap-1.5">
          {/* Section labels set like the editor's: the small uppercase eyebrow is what marks a
              section off from the column of properties above it. */}
          <h3 className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {t('tasks.fieldDescription')}
          </h3>
          {task.description ? (
            <p dir="auto" className="whitespace-pre-wrap break-words px-0.5 text-body">
              {task.description}
            </p>
          ) : (
            <p className="px-0.5 text-body text-muted-foreground">{t('tasks.viewNoDescription')}</p>
          )}
        </section>

        {task.checklist.length > 0 ? (
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2.5">
              <h3 className="text-caption font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {t('tasks.checklist')}
              </h3>
              <span className="text-caption tabular-nums text-muted-foreground">
                {t('tasks.checklistCount', { done, total: task.checklist.length })}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {task.checklist.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-1.5"
                >
                  {/* Ticking writes through on the tap, the way the editor's list does; the API
                      keeps it to the task's own people. */}
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label={item.title}
                    disabled={tick.isPending}
                    onChange={(event) =>
                      tick.mutate({ itemId: item.id, done: event.target.checked })
                    }
                    className="size-4 flex-none accent-primary"
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 break-words text-body',
                      item.done && 'text-muted-foreground line-through',
                    )}
                  >
                    <bdi>{item.title}</bdi>
                  </span>
                  {item.assignees.length > 0 ? (
                    <AvatarStack people={item.assignees} label={t('tasks.stepOwners')} />
                  ) : null}
                </li>
              ))}
            </ul>
            {tick.isError ? (
              <p className="text-caption text-destructive">{t('tasks.checklistFailed')}</p>
            ) : null}
          </section>
        ) : null}

        <p className="text-caption text-muted-foreground">
          {[
            t('tasks.metaCreated', {
              name: task.createdBy.displayName,
              date: formatStamp(task.createdAt),
            }),
            new Date(task.updatedAt).getTime() - new Date(task.createdAt).getTime() > 60_000
              ? t('tasks.metaUpdated', { date: formatStamp(task.updatedAt) })
              : null,
            task.completedAt
              ? t('tasks.metaCompleted', { date: formatStamp(task.completedAt) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div aria-hidden="true" className="h-px bg-border" />

        <div className="flex justify-end pt-0.5">
          <Button type="button" variant="outline" onClick={close}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// The editor's property row, read-only: the icon and label name the property, the child
// states it.
function PropertyRow({
  icon,
  label,
  children,
}: { icon: IconRole; label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[38px] grid-cols-[6.625rem_minmax(0,1fr)] items-center gap-2.5">
      <span className="inline-flex items-center gap-[7px] text-label text-muted-foreground">
        <Icon name={icon} size="sm" />
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// A value at the editor's bare-control size, so the two sheets line up row for row.
function Value({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <p
      className={cn(
        'flex min-h-8 min-w-0 items-center gap-1.5 px-1.5 text-body font-semibold',
        muted ? 'font-normal text-muted-foreground' : 'text-foreground',
      )}
    >
      {children}
    </p>
  )
}
