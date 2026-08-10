import type { CreateInviteRequest, PrincipalResponse, Role } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { NativeSelect } from '../../components/ui/native-select.js'
import { ApiError, authApi } from '../../lib/api.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from './users-query.js'

interface InviteFields {
  email: string
  displayName: string
  role: Role
  locationId: string
}

// Create an invite (ui-flow, stories 3-8). What the form offers is constrained by the
// acting principal, mirroring the server-side enforcement so a user is never shown a
// choice the API will reject (ADR-0007): an Admin may pick any role and any Location; a
// Manager may create only Employee invites for their own Location, so the Manager's form
// fixes both and shows them as read-only rather than as a choice. The role and Location
// are never trusted from the client — the API re-derives what this principal may bake in —
// but constraining the form keeps the Manager from a guaranteed rejection.
export function InviteForm({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const isAdmin = principal.role === 'admin'
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<InviteFields>({
    defaultValues: {
      email: '',
      displayName: '',
      role: 'employee',
      locationId: '',
    },
  })

  // An Admin choosing the admin role invites a Location-less admin (locationId null);
  // any other role needs a Location. A Manager never reaches this branch — their role is
  // fixed to employee and their Location to their own.
  const selectedRole = form.watch('role')
  const needsLocation = isAdmin && selectedRole !== 'admin'

  // The authoritative Location list feeds the picker, retiring the paste-a-UUID field. It is
  // Admin-only server-side, so the query is gated to an admin principal — a Manager never
  // fetches it (their branch is fixed, location-less to the picker). An Admin inviting
  // another Admin also skips it, but the query still primes so switching to a located role
  // shows the picker without a fresh wait.
  const locationsQuery = useLocations({ enabled: isAdmin })
  const locations = locationsQuery.data ?? []
  // With a located role chosen but no Location to bake in, the picker would be empty and
  // un-submittable (decision 7): the invite is blocked until the query has resolved to at
  // least one Location. Inviting an Admin needs none, so that path is never blocked.
  const blockedOnLocations = needsLocation && locations.length === 0

  const mutation = useMutation({
    mutationFn: (body: CreateInviteRequest) => authApi.createInvite(body),
    onSuccess: async (user) => {
      setSentTo(user.email)
      form.reset({ email: '', displayName: '', role: 'employee', locationId: '' })
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 409) return setFailure(t('invites.conflict'))
        if (error.status === 403) return setFailure(t('invites.forbidden'))
        if (error.status === 0) return setFailure(t('common.networkError'))
      }
      setFailure(t('invites.invalidRequest'))
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setFailure(null)
    setSentTo(null)
    if (isAdmin) {
      mutation.mutate({
        email: values.email,
        displayName: values.displayName,
        role: values.role,
        // An admin invitee is Location-less; every other role carries the entered Location.
        locationId: values.role === 'admin' ? null : values.locationId,
      })
      return
    }
    // Manager: role and Location are fixed to the principal's own, never taken from inputs.
    mutation.mutate({
      email: values.email,
      displayName: values.displayName,
      role: 'employee',
      locationId: principal.locationId,
    })
  })

  // The Location control for an Admin picking a located role: a name-showing picker over the
  // real list, or — when there is no Location yet (decision 7) — a prompt to create one first
  // (L2's `/locations` screen), so the Admin never faces an empty, un-submittable picker.
  // Loading and load-failure are surfaced plainly rather than silently blocking.
  function renderLocationField() {
    if (locationsQuery.isPending) {
      return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
    }
    if (locationsQuery.isError) {
      return <Alert tone="error">{t('invites.locationsLoadFailed')}</Alert>
    }
    if (locations.length === 0) {
      return (
        <Alert tone="info">
          {t('invites.locationEmpty')}{' '}
          <Link to="/locations" className="underline underline-offset-4">
            {t('invites.locationEmptyLink')}
          </Link>
        </Alert>
      )
    }
    return (
      <Field label={t('invites.location')}>
        {(props) => (
          <NativeSelect {...props} {...form.register('locationId', { required: true })}>
            <option value="">{t('invites.locationPlaceholder')}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
    )
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <h2 className="text-heading-sm font-semibold text-foreground">
        {t('invites.createHeading')}
      </h2>

      {sentTo ? <Alert tone="success">{t('invites.sent', { email: sentTo })}</Alert> : null}
      {failure ? <Alert tone="error">{failure}</Alert> : null}

      <Field label={t('common.email')}>
        {(props) => (
          <Input type="email" {...props} {...form.register('email', { required: true })} />
        )}
      </Field>

      <Field label={t('invites.displayName')}>
        {(props) => <Input {...props} {...form.register('displayName', { required: true })} />}
      </Field>

      {isAdmin ? (
        <>
          <Field label={t('invites.role')}>
            {(props) => (
              <NativeSelect {...props} {...form.register('role')}>
                <option value="employee">{t('invites.roleEmployee')}</option>
                <option value="manager">{t('invites.roleManager')}</option>
                <option value="admin">{t('invites.roleAdmin')}</option>
              </NativeSelect>
            )}
          </Field>
          {needsLocation ? renderLocationField() : null}
        </>
      ) : (
        // A Manager's fixed remit, shown so the constraint is visible, not chosen.
        <Alert tone="info">{t('invites.managerFixedRole')}</Alert>
      )}

      <Button type="submit" disabled={mutation.isPending || blockedOnLocations}>
        {mutation.isPending ? t('common.working') : t('invites.send')}
      </Button>
    </form>
  )
}
