import {
  type CreateInviteRequest,
  type PrincipalResponse,
  ROLES,
  type Role,
  hasAdminAuthority,
  isSuperAdmin,
} from '@burgers/shared'
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
import { roleLabelKey } from '../../i18n/labels.js'
import { ApiError, authApi } from '../../lib/api.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from './users-query.js'

interface InviteFields {
  email: string
  displayName: string
  role: Role
  locationId: string
}

// The role menu, junior first: the seniority list reversed, so it opens on Employee.
const OFFERED_ROLES = [...ROLES].reverse()

// Create an invite (ui-flow, stories 3-8), housed in the roster's Dialog since The Counter
// (round 8) — the Dialog owns the title and intro line, this owns the fields and the
// Cancel / Send invite footer. What the form offers is constrained by the acting principal,
// mirroring the server-side enforcement so a user is never shown a choice the API will
// reject (ADR-0007): a super_admin, the chain's only Location-less role, may pick any role
// and any Location; a branch admin may appoint only Manager or Employee, always into their
// own Location — the same fixed, read-only remit a Manager already sees, since a branch
// admin's own Location and a Manager's own Location are constrained identically here. The
// role and Location are never trusted from the client — the API re-derives what this
// principal may bake in — but constraining the form keeps a lesser principal from a
// guaranteed rejection.
export function InviteForm({
  principal,
  onClose,
  initialRole,
  initialLocationId,
}: {
  principal: PrincipalResponse
  onClose: () => void
  // Where the form opens mid-thought — the branch staffing slots open it with the slot's role
  // and branch already chosen (owner ask 2026-08-27). Prefills, not locks: the fields stay
  // editable, and the server still re-derives what this principal may bake in either way.
  initialRole?: Role
  initialLocationId?: string
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const isAdmin = hasAdminAuthority(principal.role)
  const isChainWide = isSuperAdmin(principal.role)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const defaultFields: InviteFields = {
    email: '',
    displayName: '',
    role: initialRole ?? 'employee',
    locationId: initialLocationId ?? '',
  }
  const form = useForm<InviteFields>({ defaultValues: defaultFields })

  // A super_admin choosing the super_admin role invites a Location-less peer (locationId
  // null); every other role needs a Location — including admin, since only a super_admin is
  // ever Location-less now. Only a super_admin picks among Locations, though: a branch
  // admin's own Location is fixed and baked in without a control, the same fixed, read-only
  // remit a Manager already sees (below), so needsLocation gates on the principal being
  // chain-wide, not merely on the role picked.
  const selectedRole = form.watch('role')
  const needsLocation = isChainWide && !isSuperAdmin(selectedRole)

  // The authoritative Location list feeds the picker, retiring the paste-a-UUID field. Only a
  // super_admin ever sees that picker, so the query is gated to a chain-wide principal — a
  // Manager never fetches it (their branch is fixed, no picker to feed), and neither does a
  // branch admin, whose own Location is equally fixed. Inviting a super_admin skips it at
  // render time, but the query still primes so switching to a located role shows the picker
  // without a fresh wait.
  const locationsQuery = useLocations({ enabled: isChainWide })
  const locations = locationsQuery.data ?? []
  // With a located role chosen but no Location to bake in, the picker would be empty and
  // un-submittable (decision 7): the invite is blocked until the query has resolved to at
  // least one Location. Inviting a super_admin needs none, so that path is never blocked.
  const blockedOnLocations = needsLocation && locations.length === 0

  const mutation = useMutation({
    mutationFn: (body: CreateInviteRequest) => authApi.createInvite(body),
    onSuccess: async (user) => {
      setSentTo(user.email)
      form.reset(defaultFields)
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
    if (isChainWide) {
      mutation.mutate({
        email: values.email,
        displayName: values.displayName,
        role: values.role,
        // A super_admin invitee is Location-less; every other role, admin included, carries
        // the entered Location.
        locationId: isSuperAdmin(values.role) ? null : values.locationId,
      })
      return
    }
    if (isAdmin) {
      // A branch admin: role is chosen (Manager or Employee), but Location is never a form
      // input — it is fixed to their own, the same way a Manager's is below.
      mutation.mutate({
        email: values.email,
        displayName: values.displayName,
        role: values.role,
        locationId: principal.locationId,
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
      return <p className="text-body text-muted-foreground">{t('common.working')}</p>
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
                {/* Junior first, so the first option — the default hire — is the least
                    privileged. A branch admin appoints below the admin line only; a
                    super_admin may hand out any role in the schema. */}
                {OFFERED_ROLES.filter(
                  (role) => isSuperAdmin(principal.role) || !hasAdminAuthority(role),
                ).map((role) => (
                  <option key={role} value={role}>
                    {t(roleLabelKey(role))}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {needsLocation ? renderLocationField() : null}
          {/* The one behaviour worth a line under the fields (the artifact's hint): why the
              branch field comes and goes with the chosen role. Only a super_admin ever picks
              a role that makes it happen — a branch admin's own two roles both keep it. */}
          {isSuperAdmin(principal.role) ? (
            <p className="text-caption text-muted-foreground">{t('invites.adminHint')}</p>
          ) : null}
        </>
      ) : (
        // A Manager's fixed remit, shown so the constraint is visible, not chosen.
        <Alert tone="info">{t('invites.managerFixedRole')}</Alert>
      )}

      <div className="mt-2 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || blockedOnLocations}>
          {mutation.isPending ? t('common.working') : t('invites.send')}
        </Button>
      </div>
    </form>
  )
}
