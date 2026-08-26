import type { PrincipalResponse, Task, TaskBoardResponse } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DateField } from '../../components/ui/date-field.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The private task's own editor (owner ask 2026-08-24, widened to edit and delete on
// 2026-08-25: "if its on personal task we must have full control over it"). Deliberately narrow —
// a title and an optional due date, nothing else — and that narrowness is the feature rather than
// a shortcut. Everything the full board form offers is exactly what this path may not choose: the
// task carries no branch, no project, and one assignee who is always its writer, pinned by the API
// whatever the client sends.
//
// It is the editor for EVERY role, not only those without the board (his second report the same
// day: the board sheet was offering an assignee picker on a private task, which the API then
// refused). A manager holds both paths, and a private task opens this one.

interface PersonalTaskDialogProps {
  principal: PrincipalResponse
  // The task being edited, or absent to write a new one.
  task?: Task
  onClose(): void
}

// The date field speaks a plain `yyyy-mm-dd`; the wire speaks ISO.
function dayOf(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

export function PersonalTaskDialog({ principal, task, onClose }: PersonalTaskDialogProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(task?.title ?? '')
  const [dueDate, setDueDate] = useState(dayOf(task?.dueDate ?? null))
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
    onClose()
  }

  const save = useMutation({
    mutationFn: () => {
      const dueDateIso = dueDate === '' ? null : new Date(dueDate).toISOString()
      if (task) {
        // The full-update path replaces every field, so the assignee set has to be sent — and the
        // only value it may carry is the writer themself, which is what makes this form safe to
        // point at that path.
        return tasksApi.updateTask(task.id, {
          title: title.trim(),
          description: task.description,
          priority: task.priority,
          dueDate: dueDateIso,
          assigneeIds: [principal.userId],
        })
      }
      return tasksApi.createTask({
        title: title.trim(),
        priority: 'normal',
        dueDate: dueDateIso,
        assigneeIds: [principal.userId],
        // Says which of the two boards this is for (2026-08-25). A manager holds both paths, so
        // the API can no longer infer the private one from what the caller may do.
        personal: true,
        // A private note is one line by definition — this dialog is a title and a date. Somebody
        // who wants steps opens the full sheet, which is where the checklist lives; a private task
        // has no branch, so its steps could carry no owners either way.
        checklist: [],
      })
    },
    onSuccess: (saved) => {
      // Paint the new row straight into the cache so the tab it belongs to updates before the
      // refetch lands; an edit is already in place by id.
      if (!task) {
        queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
          prev ? { ...prev, tasks: [...prev.tasks, saved] } : prev,
        )
      }
      refresh()
    },
  })

  const remove = useMutation({
    mutationFn: () => tasksApi.deleteTask(task?.id ?? ''),
    onSuccess: refresh,
    onError: () => setConfirmingDelete(false),
  })

  const pending = save.isPending || remove.isPending

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(task ? 'tasks.personalEditTitle' : 'tasks.personalTitle')}
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() === '' || pending) return
          save.mutate()
        }}
      >
        <p className="text-label text-muted-foreground">{t('tasks.personalHint')}</p>
        <Input
          aria-label={t('tasks.fieldTitle')}
          placeholder={t('tasks.fieldTitle')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
        />
        <DateField value={dueDate} onChange={setDueDate} label={t('tasks.fieldDueDate')} />
        {save.isError || remove.isError ? (
          <Alert tone="error">{t('tasks.personalFailed')}</Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Quiet until you reach for it, and the red waits for the confirm — the board sheet's
              rule, kept here so the two deletes feel like one app. */}
          {task ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="me-auto text-muted-foreground hover:text-destructive focus-visible:text-destructive"
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
          <Button type="submit" disabled={title.trim() === '' || pending}>
            {t(task ? 'tasks.save' : 'tasks.personalCreate')}
          </Button>
        </div>
      </form>

      <AlertDialog
        open={confirmingDelete}
        title={t('tasks.confirmDelete')}
        confirmLabel={t('tasks.delete')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={remove.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </Dialog>
  )
}
