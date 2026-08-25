import type { PrincipalResponse, TaskBoardResponse } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DateField } from '../../components/ui/date-field.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Input } from '../../components/ui/input.js'
import { tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from './board-stream.js'

// The personal create (owner ask 2026-08-24, the tasks.createPersonal capability): the
// small dialog a role WITHOUT the full task-manage power gets. Deliberately narrow — a
// title and an optional due date, nothing else — because everything the full form offers
// is exactly what this path may not choose: the task lands on the caller's own branch with
// the caller as its only assignee, pinned by the API whatever the client sends.

interface PersonalTaskDialogProps {
  principal: PrincipalResponse
  onClose(): void
}

export function PersonalTaskDialog({ principal, onClose }: PersonalTaskDialogProps) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')

  const create = useMutation({
    mutationFn: () =>
      tasksApi.createTask({
        title: title.trim(),
        priority: 'normal',
        dueDate: dueDate === '' ? null : new Date(dueDate).toISOString(),
        assigneeIds: [principal.userId],
        // Says which of the two boards this is for (2026-08-25). A manager holds both paths, so
        // the API can no longer infer the private one from what the caller may do.
        personal: true,
      }),
    onSuccess: (task) => {
      queryClient.setQueryData<TaskBoardResponse>(TASKS_QUERY_KEY, (prev) =>
        prev ? { ...prev, tasks: [...prev.tasks, task] } : prev,
      )
      void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY })
      onClose()
    },
  })

  return (
    <Dialog open onClose={onClose} title={t('tasks.personalTitle')}>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (title.trim() === '' || create.isPending) return
          create.mutate()
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
        {create.isError ? <Alert tone="error">{t('tasks.personalFailed')}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={title.trim() === '' || create.isPending}>
            {t('tasks.personalCreate')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
