import {
  type CreateInviteRequest,
  type PrincipalResponse,
  ROLES,
  type Role,
  departmentLabel,
  hasAdminAuthority,
  isSuperAdmin,
} from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Input } from '../../components/ui/input.js'
import { NativeSelect } from '../../components/ui/native-select.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { useLocale } from '../../i18n/locale.js'
import { ApiError, authApi } from '../../lib/api.js'
import { useDepartments } from '../departments/use-departments.js'
import { useLocations } from '../locations/use-locations.js'
import { USERS_QUERY_KEY } from './users-query.js'

interface InviteFields {
  email: string
  displayName: string
  role: Role
  locationId: string
  // '' is the unanswered placeholder; the field is required, so it never reaches the API.
  departmentId: string
}

// The role menu, junior first: the seniority list reversed, so it opens on Employee.
const OFFERED_ROLES = [...ROLES].reverse()

// Create an invite (ui-flow, stories 3-8), housed in the roster's Dialog since The Counter
// (round 8) — the Dialog owns the title and intro line, this owns the fields and the
// Cancel / Send invite footer. What the form offers is constrained by the acting principal,
// mirroring the server-side enforcement so a user is never shown a choice the API will
// reject (ADR-0007): a super_admin, the chain's only Location-less role, may pick any role
// and any Location, the head office included (0051); a branch admin may appoint every role
// but the two above them (another admin, the owner), always into their own Location — the
// same fixed, read-only remit a Manager already sees, since a branch admin's own Location and
// a Manager's own Location are constrained identically here. The role and Location are never
// trusted from the client — the API re-derives what this principal may bake in — but
// constraining the form keeps a lesser principal from a guaranteed rejection.
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
  const { locale } = useLocale()
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
    departmentId: '',
  }
  const form = useForm<InviteFields>({ defaultValues: defaultFields })

  // Every role but the owner's holds a location (owner note 2026-09-21: every role can sit at
  // a branch, and the office roles sit at the head office), so a super_admin picks one for
  // any invitee but another super_admin. Only a super_admin picks among Locations, though: a
  // branch admin's own Location is fixed and baked in without a control, the same fixed,
  // read-only remit a Manager already sees (below), so needsLocation gates on the principal
  // being chain-wide, not merely on the role picked.
  const selectedRole = form.watch('role')
  const needsLocation = isChainWide && !isSuperAdmin(selectedRole)

  // The authoritative Location list feeds the picker, retiring the paste-a-UUID field. Only a
  // super_admin ever sees that picker, so the query is gated to a chain-wide principal — a
  // Manager never fetches it (their branch is fixed, no picker to feed), and neither does a
  // branch admin, whose own Location is equally fixed. Inviting a super_admin skips it at
  // render time, but the query still primes so switching to a located role shows the picker
  // without a fresh wait.
  const locationsQuery = useLocations({ enabled: isChainWide })
  // A branch admin answers for one restaurant, and the head office is not one: with admin
  // chosen the office leaves the list, and a choice of it already standing is cleared rather
  // than sent to a guaranteed 400.
  const allLocations = locationsQuery.data ?? []
  const locations =
    selectedRole === 'admin'
      ? allLocations.filter((location) => location.kind === 'branch')
      : allLocations
  const selectedLocationId = form.watch('locationId')
  useEffect(() => {
    if (selectedLocationId && !locations.some((location) => location.id === selectedLocationId)) {
      form.setValue('locationId', '')
    }
  }, [form, locations, selectedLocationId])
  // With a located role chosen but no Location to bake in, the picker would be empty and
  // un-submittable (decision 7): the invite is blocked until the query has resolved to at
  // least one Location. Inviting a super_admin needs none, so that path is never blocked.
  const blockedOnLocations = needsLocation && locations.length === 0

  // The department picker (2026-09-20) is asked of every role and every inviter, because a
  // department is a kind of work rather than a place. Required since 2026-09-21 (owner: "a
  // department input is a must"): every person sits somewhere from the day they are invited, so
  // the picker opens on a placeholder rather than a default, and the form will not send until
  // one is chosen. A list that has not loaded, or failed to, blocks Send the way an empty
  // Location list does, and the failure is said under the field.
  const departmentsQuery = useDepartments()
  const departments = departmentsQuery.data ?? []
  const blockedOnDepartments = departments.length === 0
  // Read in render so react-hook-form subscribes this component to the field's error: the
  // placeholder left standing at Send is the one mistake this form can make silently otherwise.
  const departmentMissing = Boolean(form.formState.errors.departmentId)

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
        // A branch-less invitee (super_admin or an HQ role) carries no Location; the branch
        // trio carries the entered one.
        locationId: isSuperAdmin(values.role) ? null : values.locationId,
        departmentId: values.departmentId,
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
        departmentId: values.departmentId,
      })
      return
    }
    // Manager: role and Location are fixed to the principal's own, never taken from inputs.
    mutation.mutate({
      email: values.email,
      displayName: values.displayName,
      role: 'employee',
      locationId: principal.locationId,
      departmentId: values.departmentId,
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

  function renderDepartmentField() {
    const error = departmentsQuery.isError
      ? t('invites.departmentsLoadFailed')
      : departmentMissing
        ? t('invites.departmentRequired')
        : undefined
    return (
      <Field label={t('invites.department')} error={error}>
        {(props) => (
          <NativeSelect
            {...props}
            aria-required
            {...form.register('departmentId', { required: true })}
          >
            <option value="">{t('invites.departmentPlaceholder')}</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {departmentLabel(department, locale)}
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
          {/* Role and department side by side (2026-09-20): the two answers to "what will
              they do", read together, with the branch — "where" — on its own line below. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('invites.role')}>
              {(props) => (
                <NativeSelect {...props} {...form.register('role')}>
                  {/* Junior first, so the first option — the default hire — is the least
                      privileged. A branch admin is on top of everyone at their branch and
                      hires every role below the admin line into it; the two above it, another
                      admin and the owner, are the chain owner's to hand out, who may hand out
                      any role in the schema. */}
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
            {renderDepartmentField()}
          </div>
          {needsLocation ? renderLocationField() : null}
          {/* The one behaviour worth a line under the fields (the artifact's hint): why the
              location field comes and goes with the chosen role. Only a super_admin ever picks
              the one role that makes it go. */}
          {isSuperAdmin(principal.role) ? (
            <p className="text-caption text-muted-foreground">{t('invites.adminHint')}</p>
          ) : null}
        </>
      ) : (
        <>
          {/* A Manager's fixed remit, shown so the constraint is visible, not chosen. The
              department is still theirs to ask, since it is not part of that remit. */}
          <Alert tone="info">{t('invites.managerFixedRole')}</Alert>
          {renderDepartmentField()}
        </>
      )}

      <div className="mt-2 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={mutation.isPending || blockedOnLocations || blockedOnDepartments}
        >
          {mutation.isPending ? t('common.working') : t('invites.send')}
        </Button>
      </div>
    </form>
  )
}
