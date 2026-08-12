import { passwordSchema } from '@burgers/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { z } from 'zod'
import { AuthLayout } from '../components/auth-layout.js'
import { PasswordField } from '../components/password-field.js'
import { Alert } from '../components/ui/alert.js'
import { Button } from '../components/ui/button.js'
import { CardDescription, CardTitle } from '../components/ui/card.js'
import { authApi, classifyAuthError } from '../lib/api.js'

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
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [failed, setFailed] = useState<'token' | 'network' | null>(null)

  const form = useForm<ConsumeForm>({
    resolver: zodResolver(consumeFormSchema),
    defaultValues: { password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ConsumeForm) =>
      authApi.consumeReset({ token: token ?? '', password: values.password }),
    // The reset revoked every session server-side (story 29), so there is no session to
    // enter with; send the user to login to sign in afresh, carrying a success banner
    // through the router state (ui-flow: "sent to login").
    onSuccess: () => navigate('/login', { replace: true, state: { resetDone: true } }),
    onError: (error) => {
      form.resetField('password')
      setFailed(classifyAuthError(error) === 'network' ? 'network' : 'token')
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
        {failed === 'token' ? <Alert tone="error">{t('resetConsume.badToken')}</Alert> : null}

        <PasswordField
          register={form.register('password')}
          invalid={Boolean(form.formState.errors.password)}
        />

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('resetConsume.submit')}
        </Button>

        {failed === 'token' ? (
          <Link
            to="/reset"
            className="text-center text-sm text-link underline underline-offset-4"
          >
            {t('resetConsume.requestNew')}
          </Link>
        ) : null}
      </form>
    </AuthLayout>
  )
}
