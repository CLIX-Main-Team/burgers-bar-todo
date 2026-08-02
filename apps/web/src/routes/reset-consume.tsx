import { PASSWORD_MIN_LENGTH, passwordSchema } from '@burgers/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { z } from 'zod'
import { AuthLayout } from '../components/auth-layout.js'
import { Alert } from '../components/ui/alert.js'
import { Button } from '../components/ui/button.js'
import { CardDescription, CardTitle } from '../components/ui/card.js'
import { Field } from '../components/ui/field.js'
import { Input } from '../components/ui/input.js'
import { ApiError, authApi } from '../lib/api.js'

const consumeFormSchema = z.object({ password: passwordSchema })
type ConsumeForm = z.infer<typeof consumeFormSchema>

// Reset consume (ui-flow, stories 26, 28, 29, 36). Reached only via the one-time reset
// link, whose token this screen reads on load. Setting a new password succeeds and, as a
// consequence the user does not have to ask for, the API has already revoked every one of
// their sessions — so no session comes back and the user is sent to login to sign in
// afresh. A bad, expired, or used token shows a clear message with a path back to
// request a new link.
export function ResetConsumeScreen() {
  const t = useTranslations()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState<'token' | 'network' | null>(null)

  const form = useForm<ConsumeForm>({
    resolver: zodResolver(consumeFormSchema),
    defaultValues: { password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ConsumeForm) =>
      authApi.consumeReset({ token: token ?? '', password: values.password }),
    onSuccess: () => setDone(true),
    onError: (error) => {
      form.resetField('password')
      setFailed(error instanceof ApiError && error.status === 0 ? 'network' : 'token')
    },
  })

  if (!token) {
    return (
      <AuthLayout>
        <CardTitle>{t('resetConsume.title')}</CardTitle>
        <Alert tone="error" className="mt-4">
          {t('resetConsume.missingToken')}
        </Alert>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout>
        <CardTitle>{t('resetConsume.title')}</CardTitle>
        <div className="mt-5 flex flex-col gap-4">
          <Alert tone="success">{t('resetConsume.success')}</Alert>
          <Link
            to="/login"
            className="text-center text-sm text-slate-600 underline hover:text-slate-900"
          >
            {t('resetRequest.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <CardTitle>{t('resetConsume.title')}</CardTitle>
      <CardDescription>{t('common.appName')}</CardDescription>

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => {
          setFailed(null)
          mutation.mutate(values)
        })}
      >
        {failed === 'network' ? <Alert tone="error">{t('common.networkError')}</Alert> : null}
        {failed === 'token' ? (
          <Alert tone="error">
            <span>{t('resetConsume.badToken')}</span>
          </Alert>
        ) : null}

        <Field
          label={t('common.newPassword')}
          hint={t('resetConsume.passwordHint', { min: PASSWORD_MIN_LENGTH })}
          error={
            form.formState.errors.password
              ? t('resetConsume.passwordHint', { min: PASSWORD_MIN_LENGTH })
              : undefined
          }
        >
          {(props) => (
            <Input
              type="password"
              autoComplete="new-password"
              {...props}
              {...form.register('password')}
            />
          )}
        </Field>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('resetConsume.submit')}
        </Button>

        {failed === 'token' ? (
          <Link
            to="/reset"
            className="text-center text-sm text-slate-600 underline hover:text-slate-900"
          >
            {t('resetConsume.requestNew')}
          </Link>
        ) : null}
      </form>
    </AuthLayout>
  )
}
