import { type UserSummary, departmentLabel } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Field } from '../../components/ui/field.js'
import { NativeSelect } from '../../components/ui/native-select.js'
import { useLocale } from '../../i18n/locale.js'
import { authApi } from '../../lib/api.js'
import { useDeferredClose } from '../../lib/use-exit-transition.js'
import { useDepartments } from '../departments/use-departments.js'
import { USERS_QUERY_KEY } from './users-query.js'

// Place a person in a department, or unplace them (2026-09-20). Reached from the person's
// actions menu, beside deactivate, because changing where someone sits is rare and deliberate,
// and the app already keeps its rare per-person acts behind that one menu rather than as
// controls that sit in every row. A small form with an explicit Save, not a select that writes
// on change: a write the admin did not mean to make should take a second press to happen, and
// a failure needs somewhere to say so — under the field, with the choice still standing.
//
// The picker's first option is "No department", the same real answer the invite form offers;
// the dialog opens on the person's current answer so Save with nothing touched is harmless.
//
// Mounted only while open, like the task dialogs, so the picker starts from the person's
// CURRENT department every time rather than from whatever it showed last; and it closes itself
// before telling the parent (useDeferredClose) so the exit can play before the unmount.
export function ChangeDepartmentDialog({
  user,
  onClose,
}: {
  user: UserSummary
  onClose: () => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const queryClient = useQueryClient()
  const { open, close } = useDeferredClose(onClose)
  const departments = useDepartments().data ?? []
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? '')
  const [failed, setFailed] = useState(false)

  const save = useMutation({
    mutationFn: () => authApi.updateUser(user.id, { departmentId: departmentId || null }),
    onSuccess: async () => {
      // The roster re-reads the row rather than trusting the response, the way every other
      // person action does, so the header and the row change together.
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
      close()
    },
    onError: () => setFailed(true),
  })

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('users.changeDepartment')}
      description={t('users.changeDepartmentBody', { name: user.displayName })}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          setFailed(false)
          save.mutate()
        }}
      >
        {failed ? <Alert tone="error">{t('users.actionFailed')}</Alert> : null}
        <Field label={t('users.department')}>
          {(props) => (
            <NativeSelect
              {...props}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">{t('invites.departmentNone')}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {departmentLabel(department, locale)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button variant="outline" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('common.working') : t('users.saveDepartment')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
