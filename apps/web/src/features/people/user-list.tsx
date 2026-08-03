import type { PrincipalResponse, UserStatus, UserSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Field } from '../../components/ui/field.js'
import { Select } from '../../components/ui/select.js'
import { roleLabelKey, sectionEmptyKey, statusLabelKey } from '../../i18n/labels.js'
import { authApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'

export const USERS_QUERY_KEY = ['users'] as const

// The roster reads the way a person reasons about it: who is still pending, who is on,
// who is off. Fixed order so the three sections never reshuffle between renders.
const SECTIONS: readonly UserStatus[] = ['invited', 'active', 'deactivated']

// The admin Location filter's two reserved option values, kept out of the uuid space a
// real Location id occupies: ALL is the unfiltered default, CHAIN_WIDE the bucket a
// location-less (chain-wide) admin falls into.
const FILTER_ALL = 'all'
const FILTER_CHAIN_WIDE = 'chain-wide'

// User-status reads through the soft status variants (issue #101, ui-flow): an awaited
// invite is warning, an active user is success, and a deactivated one is the neutral
// muted surface — the soft tints keep the small status text above 4.5:1 in both themes
// (components.md Badge mapping). Rendered inline here rather than through the Badge
// primitive, which is one of the not-yet-built primitives (out of scope for this feature).
const statusChip: Record<UserStatus, string> = {
  invited: 'bg-warning-muted text-warning-muted-foreground',
  active: 'bg-success-muted text-success-muted-foreground',
  deactivated: 'bg-muted text-muted-foreground',
}

// The scoped, sectioned people list (Slice U1 — the read). The list scope is derived
// server-side from the principal, never requested here (ADR-0007): an admin sees every
// user across every Location, a manager only their own. What differs by audience is
// presentation — the admin's chain-wide list carries a Location column and a Location
// filter, while a manager's single-Location list drops both as redundant. The rows still
// carry the row actions #35 shipped (resend/revoke, and admin-only deactivate/reactivate);
// this slice reshapes the list around them rather than removing them.
export function UserList({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const isAdmin = principal.role === 'admin'
  const query = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  // The admin's Location filter is a client-side narrowing of the already-scoped list, so
  // no query parameter and no extra request — the cleaner path the umbrella spec preferred
  // over a backend touch. A manager never sees the control, so the state simply sits unused.
  const [locationFilter, setLocationFilter] = useState(FILTER_ALL)

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('users.loadFailed')}</Alert>
  }

  const users = query.data.users
  // Filter options are the distinct Locations actually present in the list: each real
  // Location id, plus a chain-wide bucket only when a location-less admin is in view.
  const locationIds = Array.from(
    new Set(users.map((user) => user.locationId).filter((id): id is string => id !== null)),
  )
  const hasChainWide = users.some((user) => user.locationId === null)

  const visible = users.filter((user) => {
    if (!isAdmin || locationFilter === FILTER_ALL) {
      return true
    }
    if (locationFilter === FILTER_CHAIN_WIDE) {
      return user.locationId === null
    }
    return user.locationId === locationFilter
  })

  return (
    <div className="flex flex-col gap-6">
      {isAdmin ? (
        <Field label={t('users.filterLocation')}>
          {(props) => (
            <Select
              {...props}
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value={FILTER_ALL}>{t('users.filterAllLocations')}</option>
              {locationIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              {hasChainWide ? (
                <option value={FILTER_CHAIN_WIDE}>{t('users.locationChainWide')}</option>
              ) : null}
            </Select>
          )}
        </Field>
      ) : null}

      {SECTIONS.map((status) => (
        <UserSection
          key={status}
          status={status}
          users={visible.filter((user) => user.status === status)}
          isAdmin={isAdmin}
        />
      ))}
    </div>
  )
}

// One status section: its title with a count, and either the rows in it or an explicit
// empty line so "no one invited" reads as a state rather than a vanished section (story 13).
function UserSection({
  status,
  users,
  isAdmin,
}: {
  status: UserStatus
  users: UserSummary[]
  isAdmin: boolean
}) {
  const t = useTranslations()
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {t(statusLabelKey(status))}
        <span className="text-xs font-normal text-muted-foreground">{users.length}</span>
      </h3>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(sectionEmptyKey(status))}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((user) => (
            <UserRow key={user.id} user={user} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </section>
  )
}

function UserRow({ user, isAdmin }: { user: UserSummary; isAdmin: boolean }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [actionFailed, setActionFailed] = useState(false)

  // Every row action ends by refreshing the list, so the row's new state (a removed
  // pending user, a flipped status) is read back from the API rather than guessed.
  const onSettled = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
    onError: () => setActionFailed(true),
  }
  const resend = useMutation({ mutationFn: () => authApi.resendInvite(user.id), ...onSettled })
  const revoke = useMutation({ mutationFn: () => authApi.revokeInvite(user.id), ...onSettled })
  const deactivate = useMutation({
    mutationFn: () => authApi.deactivateUser(user.id),
    ...onSettled,
  })
  const reactivate = useMutation({
    mutationFn: () => authApi.reactivateUser(user.id),
    ...onSettled,
  })
  const busy = resend.isPending || revoke.isPending || deactivate.isPending || reactivate.isPending

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{user.displayName}</p>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-flex items-center rounded-sm px-2 py-0.5 font-medium',
              statusChip[user.status],
            )}
          >
            {t(statusLabelKey(user.status))}
          </span>
          <span>{t(roleLabelKey(user.role))}</span>
          {/* The Location column is admin-only: a manager's list is a single Location, so
              the same value on every row would be noise (stories 8, 10). A location-less
              (chain-wide) admin reads as "Chain-wide", never a blank cell (story 12). */}
          {isAdmin ? (
            <span>
              <span className="text-muted-foreground">{t('users.location')}: </span>
              {user.locationId ?? t('users.locationChainWide')}
            </span>
          ) : null}
        </p>
        {actionFailed ? (
          <p className="mt-1 text-xs text-destructive">{t('users.actionFailed')}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        {user.status === 'invited' ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setActionFailed(false)
                resend.mutate()
              }}
            >
              {t('users.resend')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setActionFailed(false)
                revoke.mutate()
              }}
            >
              {t('users.revoke')}
            </Button>
          </>
        ) : null}

        {isAdmin && user.status === 'active' ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              setActionFailed(false)
              deactivate.mutate()
            }}
          >
            {t('users.deactivate')}
          </Button>
        ) : null}

        {isAdmin && user.status === 'deactivated' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setActionFailed(false)
              reactivate.mutate()
            }}
          >
            {t('users.reactivate')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
