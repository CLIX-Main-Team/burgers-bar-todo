import type { PrincipalResponse, Role, UserStatus, UserSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { authApi } from '../../lib/api.js'

export const USERS_QUERY_KEY = ['users'] as const

// The scoped people list (ui-flow, invite/deactivate surfaces). An Admin sees every
// user, a Manager only their own Location — the scope is derived server-side from the
// principal, never requested here. Each row carries exactly the actions its status and
// the caller's role allow: resend/revoke on a pending invite (Admin or Manager),
// deactivate on an active user and reactivate on a deactivated one (Admin only). This is
// the feature-depth surface issue #25 delivers, not a full user-management screen.
export function UserList({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const query = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })

  if (query.isPending) {
    return <p className="text-sm text-slate-400">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('users.loadFailed')}</Alert>
  }

  const users = query.data.users
  if (users.length === 0) {
    return <p className="text-sm text-slate-500">{t('users.empty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {users.map((user) => (
        <UserRow key={user.id} user={user} isAdmin={principal.role === 'admin'} />
      ))}
    </div>
  )
}

function roleLabel(t: (key: string) => string, role: Role): string {
  return t(
    role === 'admin'
      ? 'invites.roleAdmin'
      : role === 'manager'
        ? 'invites.roleManager'
        : 'invites.roleEmployee',
  )
}

function statusLabel(t: (key: string) => string, status: UserStatus): string {
  return t(
    status === 'invited'
      ? 'users.statusInvited'
      : status === 'active'
        ? 'users.statusActive'
        : 'users.statusDeactivated',
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
    <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{user.displayName}</p>
        <p className="truncate text-sm text-slate-500">{user.email}</p>
        <p className="text-xs text-slate-400">
          {roleLabel(t, user.role)} · {statusLabel(t, user.status)}
          {user.locationId ? ` · ${user.locationId}` : ''}
        </p>
        {actionFailed ? (
          <p className="mt-1 text-xs text-red-600">{t('users.actionFailed')}</p>
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
