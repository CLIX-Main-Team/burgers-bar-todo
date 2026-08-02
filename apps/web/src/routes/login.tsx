import { type SignInRequest, signInRequestSchema } from '@burgers/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
import { AuthLayout } from '../components/auth-layout.js'
import { Alert } from '../components/ui/alert.js'
import { Button } from '../components/ui/button.js'
import { CardDescription, CardTitle } from '../components/ui/card.js'
import { Field } from '../components/ui/field.js'
import { Input } from '../components/ui/input.js'
import { authApi, classifyAuthError } from '../lib/api.js'

// Login — the app's front door (ui-flow, stories 17-20). Email + password + submit,
// with the language toggle (from AuthLayout) and a reset-request link. Success stores
// the bearer and enters the app; any failure shows one generic message and stays here
// with the password cleared, so an attacker cannot tell a real email from a fake one.
export function LoginScreen() {
  const t = useTranslations()
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn } = useSession()
  const [failed, setFailed] = useState<'credentials' | 'network' | null>(null)
  // A completed password reset lands here (reset-consume sends the user to login); show
  // the confirmation once so they know to sign in with the new password.
  const resetDone = (location.state as { resetDone?: boolean } | null)?.resetDone === true

  const form = useForm<SignInRequest>({
    resolver: zodResolver(signInRequestSchema),
    defaultValues: { email: '', password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: SignInRequest) => authApi.signIn(values),
    onSuccess: async ({ token }) => {
      await signIn(token)
      navigate('/', { replace: true })
    },
    onError: (error) => {
      // Clear the password on any failure (ui-flow, login failure). A transport error is
      // told apart from a credential failure only so the user gets an actionable message;
      // every credential case shares the one generic string.
      form.resetField('password')
      setFailed(classifyAuthError(error) === 'network' ? 'network' : 'credentials')
    },
  })

  return (
    <AuthLayout>
      <CardTitle>{t('login.title')}</CardTitle>
      <CardDescription>{t('common.appName')}</CardDescription>

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => {
          setFailed(null)
          mutation.mutate(values)
        })}
      >
        {resetDone && !failed ? <Alert tone="success">{t('resetConsume.success')}</Alert> : null}
        {failed ? (
          <Alert tone="error">
            {failed === 'network' ? t('common.networkError') : t('login.failed')}
          </Alert>
        ) : null}

        <Field label={t('common.email')}>
          {(props) => (
            <Input type="email" autoComplete="username" {...props} {...form.register('email')} />
          )}
        </Field>

        <Field label={t('common.password')}>
          {(props) => (
            <Input
              type="password"
              autoComplete="current-password"
              {...props}
              {...form.register('password')}
            />
          )}
        </Field>

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('login.submit')}
        </Button>

        <Link
          to="/reset"
          className="text-center text-sm text-slate-600 underline hover:text-slate-900"
        >
          {t('login.forgotPassword')}
        </Link>
      </form>
    </AuthLayout>
  )
}
