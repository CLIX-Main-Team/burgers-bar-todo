import { passwordSchema } from '@burgers/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { z } from 'zod'
import { useSession } from '../auth/session.js'
import { AuthLayout } from '../components/auth-layout.js'
import { PasswordField } from '../components/password-field.js'
import { Alert } from '../components/ui/alert.js'
import { Button } from '../components/ui/button.js'
import { CardDescription, CardTitle } from '../components/ui/card.js'
import { useLocale } from '../i18n/locale.js'
import { authApi, classifyAuthError } from '../lib/api.js'

// Only the password is entered on this screen; the language comes from the toggle and
// the token from the link.
const acceptFormSchema = z.object({ password: passwordSchema })
type AcceptForm = z.infer<typeof acceptFormSchema>

// Accept an invite and set a password (ui-flow, stories 12-16). Reached only via the
// one-time invite link, whose token this screen reads on load. The language the
// recipient picks with the toggle is saved as their preferred_language; success sets the
// password, activates the account, and signs them straight in with no separate login.
//
// Role and Location were baked into the invite and are immutable by the recipient
// (ADR-0005), so they are not shown as editable. The inviter-set display name is not
// rendered here: the auth API delivered by the earlier slices exposes no pre-accept
// invite-read endpoint to fetch it from (see ui-flow.md, kept in step with this).
export function AcceptScreen() {
  const t = useTranslations()
  const navigate = useNavigate()
  const { signIn } = useSession()
  const { locale } = useLocale()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [failed, setFailed] = useState<'token' | 'network' | null>(null)

  const form = useForm<AcceptForm>({
    resolver: zodResolver(acceptFormSchema),
    defaultValues: { password: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: AcceptForm) =>
      authApi.acceptInvite({
        token: token ?? '',
        password: values.password,
        // The toggle's current value is the saved preference (ui-flow, story 14).
        preferredLanguage: locale,
      }),
    onSuccess: async ({ token: sessionToken }) => {
      await signIn(sessionToken)
      navigate('/', { replace: true })
    },
    onError: (error) => {
      form.resetField('password')
      setFailed(classifyAuthError(error) === 'network' ? 'network' : 'token')
    },
  })

  // A link opened without its token cannot proceed; tell the recipient to use the email.
  if (!token) {
    return (
      <AuthLayout>
        <CardTitle>{t('accept.title')}</CardTitle>
        <Alert tone="error" className="mt-4">
          {t('accept.missingToken')}
        </Alert>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <CardTitle>{t('accept.title')}</CardTitle>
      <CardDescription>{t('accept.intro')}</CardDescription>

      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => {
          setFailed(null)
          mutation.mutate(values)
        })}
      >
        {failed ? (
          <Alert tone="error">
            {failed === 'network' ? t('common.networkError') : t('accept.badToken')}
          </Alert>
        ) : null}

        <PasswordField
          register={form.register('password')}
          invalid={Boolean(form.formState.errors.password)}
        />

        <Button type="submit" className="h-11" disabled={mutation.isPending}>
          {mutation.isPending ? t('common.working') : t('accept.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
