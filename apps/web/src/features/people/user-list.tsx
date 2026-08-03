import type { PrincipalResponse, UserStatus, UserSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { roleLabelKey, statusLabelKey } from '../../i18n/labels.js'
import { authApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'

export const USERS_QUERY_KEY = ['users'] as const

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
    return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('users.loadFailed')}</Alert>
  }

  const users = query.data.users
  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('users.empty')}</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {users.map((user) => (
        <UserRow key={user.id} user={user} isAdmin={principal.role === 'admin'} />
      ))}
    </div>
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
      <div className="min-w-0">
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
          <span>
            {t(roleLabelKey(user.role))}
            {user.locationId ? ` · ${user.locationId}` : ''}
          </span>
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
