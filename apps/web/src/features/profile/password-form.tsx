import { type ChangePasswordRequest, PASSWORD_MIN_LENGTH } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { PasswordField } from '../../components/password-field.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, authApi } from '../../lib/api.js'

// Change your own password while signed in (Profile page, 2026-09-04). Three fields: the current
// one, because a session left open on a shared till must not be enough to lock its owner out;
// the new one, through the same PasswordField accept and reset use so the minimum-length rule
// and its wording cannot drift; and a confirmation, because a password is the one field a person
// cannot read back. The API's one specific refusal — wrong current password — lands on the field
// it belongs to; everything else is the generic banner.

interface PasswordFields {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const EMPTY: PasswordFields = { currentPassword: '', newPassword: '', confirmPassword: '' }

export function PasswordForm() {
  const t = useTranslations()
  const form = useForm<PasswordFields>({ defaultValues: EMPTY })
  const [changed, setChanged] = useState(false)
  const [wrongCurrent, setWrongCurrent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: ChangePasswordRequest) => authApi.changePassword(body),
    onSuccess: () => {
      form.reset(EMPTY)
      setChanged(true)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setWrongCurrent(true)
        return
      }
      setFailure(
        error instanceof ApiError && error.status === 0
          ? t('common.networkError')
          : t('profile.passwordFailed'),
      )
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setChanged(false)
    setWrongCurrent(false)
    setFailure(null)
    mutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword })
  })

  const errors = form.formState.errors
  const currentError = wrongCurrent
    ? t('profile.wrongPassword')
    : errors.currentPassword
      ? t('profile.currentRequired')
      : undefined

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <Field label={t('profile.currentPassword')} error={currentError}>
        {(props) => (
          <Input
            type="password"
            autoComplete="current-password"
            {...props}
            {...form.register('currentPassword', {
              required: true,
              onChange: () => setWrongCurrent(false),
            })}
          />
        )}
      </Field>

      <PasswordField
        register={form.register('newPassword', { required: true, minLength: PASSWORD_MIN_LENGTH })}
        invalid={Boolean(errors.newPassword)}
      />

      <Field
        label={t('profile.confirmPassword')}
        error={errors.confirmPassword ? t('profile.confirmMismatch') : undefined}
      >
        {(props) => (
          <Input
            type="password"
            autoComplete="new-password"
            {...props}
            {...form.register('confirmPassword', {
              validate: (value, values) => value === values.newPassword,
            })}
          />
        )}
      </Field>

      <div aria-live="polite" className="empty:hidden">
        {changed ? <Alert tone="success">{t('profile.passwordChanged')}</Alert> : null}
        {failure ? <Alert tone="error">{failure}</Alert> : null}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('profile.changePassword')}
        </Button>
      </div>
    </form>
  )
}
