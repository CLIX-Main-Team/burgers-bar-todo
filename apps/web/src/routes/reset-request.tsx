import {
  type RequestPasswordResetRequest,
  requestPasswordResetRequestSchema,
} from '@burgers/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { AuthLayout } from '../components/auth-layout.js'
import { Alert } from '../components/ui/alert.js'
import { Button } from '../components/ui/button.js'
import { CardDescription, CardTitle } from '../components/ui/card.js'
import { Field } from '../components/ui/field.js'
import { Input } from '../components/ui/input.js'
import { ApiError, authApi } from '../lib/api.js'

// Reset request (ui-flow, stories 26-30). Email + submit. The screen always shows the
// same generic confirmation whether or not the address is registered, active, or
// throttled — the API returns one non-enumerating acknowledgement and the UI never
// branches its wording on the reason, so the request leaks nothing about which emails
// exist. A transport failure is the only thing told apart, since the request may not
// have reached the server at all.
export function ResetRequestScreen() {
  const t = useTranslations()
  const [confirmed, setConfirmed] = useState(false)
  const [networkFailed, setNetworkFailed] = useState(false)

  const form = useForm<RequestPasswordResetRequest>({
    resolver: zodResolver(requestPasswordResetRequestSchema),
    defaultValues: { email: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: RequestPasswordResetRequest) => authApi.requestReset(values),
    onSuccess: () => setConfirmed(true),
    onError: (error) => {
      // Only a genuine transport failure is surfaced; every server outcome is the same
      // generic confirmation, so there is no other error branch to show.
      if (error instanceof ApiError && error.status === 0) {
        setNetworkFailed(true)
      } else {
        setConfirmed(true)
      }
    },
  })

  return (
    <AuthLayout>
      <CardTitle>{t('resetRequest.title')}</CardTitle>
      <CardDescription>{t('resetRequest.intro')}</CardDescription>

      {confirmed ? (
        <div className="mt-5 flex flex-col gap-4">
          <Alert tone="success">{t('resetRequest.confirmation')}</Alert>
          <Link
            to="/login"
            className="text-center text-sm text-link underline underline-offset-4"
          >
            {t('resetRequest.backToLogin')}
          </Link>
        </div>
      ) : (
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => {
            setNetworkFailed(false)
            mutation.mutate(values)
          })}
        >
          {networkFailed ? <Alert tone="error">{t('common.networkError')}</Alert> : null}

          <Field label={t('common.email')}>
            {(props) => (
              <Input type="email" autoComplete="username" {...props} {...form.register('email')} />
            )}
          </Field>

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('common.working') : t('resetRequest.submit')}
          </Button>

          <Link
            to="/login"
            className="text-center text-sm text-link underline underline-offset-4"
          >
            {t('resetRequest.backToLogin')}
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}
