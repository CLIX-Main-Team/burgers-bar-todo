import type { UserSummary } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { authApi } from '../../lib/api.js'
import { overflowTrigger } from '../tasks/task-menu.js'
import { USERS_QUERY_KEY } from './users-query.js'

// One person's row menu (The Counter round 8 — the roster's card actions, moved behind the
// table row's ⋯). Each write refreshes the list so the row's new state is read back from the
// API, never guessed, and the API stays the sole authority (ADR-0007) — what the menu
// *offers* mirrors that authority, so it never presents a guaranteed-rejection action:
//   • resend/revoke — only a pending invite this principal may act on: an admin reaches any
//     invite, a manager only an employee invite.
//   • deactivate — admin only, on an active user that is not the acting admin's own row,
//     confirmed through the AlertDialog before the write fires.
//   • reactivate — admin only, on a deactivated user.
// A row with no permitted actions renders nothing. A failed write is reported up through
// `onError` so the roster surfaces one shared notice rather than a line squeezed into a cell.
export function PersonActions({
  user,
  isAdmin,
  isSelf,
  onError,
}: {
  user: UserSummary
  isAdmin: boolean
  isSelf: boolean
  onError: () => void
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const onSettled = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
    onError,
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

  const canActOnInvite = user.status === 'invited' && (isAdmin || user.role === 'employee')
  const canDeactivate = isAdmin && user.status === 'active' && !isSelf
  const canReactivate = isAdmin && user.status === 'deactivated'
  if (!canActOnInvite && !canDeactivate && !canReactivate) {
    return null
  }

  const label = t('users.rowMenu', { name: user.displayName })

  return (
    <>
      <DropdownMenu label={label} trigger={overflowTrigger(label)}>
        {canActOnInvite ? (
          <>
            <DropdownMenuItem disabled={busy} onSelect={() => resend.mutate()}>
              <Icon name="resend-invite" size="sm" />
              {t('users.resend')}
            </DropdownMenuItem>
            <DropdownMenuItem tone="destructive" disabled={busy} onSelect={() => revoke.mutate()}>
              <Icon name="revoke-invite" size="sm" />
              {t('users.revoke')}
            </DropdownMenuItem>
          </>
        ) : null}

        {canDeactivate ? (
          <DropdownMenuItem tone="destructive" disabled={busy} onSelect={() => setConfirmOpen(true)}>
            <Icon name="deactivate-user" size="sm" />
            {t('users.deactivate')}
          </DropdownMenuItem>
        ) : null}

        {canReactivate ? (
          <DropdownMenuItem disabled={busy} onSelect={() => reactivate.mutate()}>
            <Icon name="reactivate-user" size="sm" />
            {t('users.reactivate')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenu>

      <AlertDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          deactivate.mutate()
        }}
        title={t('users.deactivateConfirmTitle', { name: user.displayName })}
        description={t('users.deactivateConfirmBody')}
        confirmLabel={t('users.deactivate')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={busy}
      />
    </>
  )
}
