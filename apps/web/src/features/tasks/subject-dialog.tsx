import type { TaskSubject } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, taskSubjectsApi } from '../../lib/api.js'
import { useDeferredClose } from '../../lib/use-exit-transition.js'
import { invalidateSubjects } from './subject-queries.js'

// The small dialog a subject is made or renamed in (owner ask 2026-09-20): a name and one
// optional line, the personal-task dialog's shape, because a subject is two facts and a form
// that asks for more would invent a third. One dialog for both gestures: create when it opens
// with a department, rename when it opens with a subject.
export function SubjectDialog({
  departmentId,
  departmentName,
  subject,
  onClose,
}: {
  // Where a new subject is filed. Ignored on rename, where the subject already knows.
  departmentId: string
  // The department's name in the UI language, for the title: a subject is filed under the
  // department on screen, and the title says so before the name is typed.
  departmentName: string
  // The subject under rename, or absent to create one.
  subject?: TaskSubject
  onClose(): void
}) {
  const { open, close } = useDeferredClose(onClose)
  const t = useTranslations()
  const [name, setName] = useState(subject?.name ?? '')
  const [description, setDescription] = useState(subject?.description ?? '')
  const nameId = useId()
  const descriptionId = useId()

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      }
      return subject
        ? taskSubjectsApi.update(subject.id, body)
        : taskSubjectsApi.create({ departmentId, ...body })
    },
    onSuccess: () => {
      invalidateSubjects()
      close()
    },
  })

  // The one refusal worth its own words: the department already has a card by that name, and
  // the writer can see it in the grid behind this dialog.
  const duplicate = save.error instanceof ApiError && save.error.status === 409

  return (
    <Dialog
      open={open}
      onClose={close}
      title={
        subject
          ? t('tasks.subjectRenameHeading')
          : t('tasks.subjectCreateHeading', { department: departmentName })
      }
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim() === '' || save.isPending) return
          save.mutate()
        }}
      >
        {/* Labels stay visible once text is typed: two look-alike boxes with their placeholders
            gone would leave nothing on screen saying which is the name. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-label font-semibold text-foreground">
            {t('tasks.subjectName')}
          </label>
          <Input
            id={nameId}
            placeholder={t('tasks.subjectNamePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            dir={name === '' ? undefined : 'auto'}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className="text-label font-semibold text-foreground">
            {t('tasks.subjectDescription')}
          </label>
          <Input
            id={descriptionId}
            placeholder={t('tasks.subjectDescriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={240}
            dir={description === '' ? undefined : 'auto'}
          />
        </div>
        {save.isError ? (
          <Alert tone="error">
            {duplicate ? t('tasks.subjectDuplicate') : t('tasks.subjectSaveFailed')}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={name.trim() === '' || save.isPending}>
            {t(subject ? 'tasks.subjectSave' : 'tasks.subjectCreate')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
