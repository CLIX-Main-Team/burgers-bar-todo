import type { UserStatus, UserSummary } from '@burgers/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Avatar } from '../../components/ui/avatar.js'
import { Badge } from '../../components/ui/badge.js'
import { Button } from '../../components/ui/button.js'
import { Card } from '../../components/ui/card.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { roleLabelKey, statusLabelKey } from '../../i18n/labels.js'
import { authApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { USERS_QUERY_KEY } from './users-query.js'

// The status Badge family per user status (mockup #179, the shipped `statusChip` mapping now
// routed through the DS Badge): a pending invite is warning, an active user success, and a
// deactivated one the neutral muted surface — the soft tints keep the small label above 4.5:1
// in both themes (components.md §Badge).
const statusVariant: Record<UserStatus, 'warning' | 'success' | 'muted'> = {
  invited: 'warning',
  active: 'success',
  deactivated: 'muted',
}

// One person in the roster, in the flagship's card language (people build, mockup #179). Owns
// its own row actions exactly as the shipped row did — each write refreshes the list so the
// row's new state is read back from the API, never guessed — and the API stays the sole
// authority (ADR-0007), so a control shown here can only ever do what the caller's scope
// already permits. What the card *offers* is scoped to mirror that authority, so the UI never
// presents a guaranteed-rejection action.
export function PersonCard({
  user,
  isAdmin,
  isSelf,
}: {
  user: UserSummary
  isAdmin: boolean
  // The acting principal's own row: its avatar reads on the `primary` ground, and it never
  // offers Deactivate (an admin does not cut their own access from the roster).
  isSelf: boolean
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [actionFailed, setActionFailed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

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

  // The row's available actions, each mirroring the API's action scope (ADR-0007) so the menu
  // never offers a control the API would reject:
  //   • resend/revoke — only a pending invite this principal may act on: an admin reaches any
  //     invite, a manager only an employee invite (the shipped `canActOnInvite`).
  //   • deactivate — admin only, on an active user that is not the acting admin's own row.
  //   • reactivate — admin only, on a deactivated user.
  const canActOnInvite = user.status === 'invited' && (isAdmin || user.role === 'employee')
  const canDeactivate = isAdmin && user.status === 'active' && !isSelf
  const canReactivate = isAdmin && user.status === 'deactivated'
  const hasActions = canActOnInvite || canDeactivate || canReactivate

  const run = (mutate: () => void) => {
    setActionFailed(false)
    mutate()
  }

  return (
    <Card
      // Tighter than the section-panel Card's p-6: a person card is a list row, so it takes the
      // card-4 padding the flagship task card uses. A deactivated row dims to ~60% — the group
      // already carries the rest of the signal, so no strikethrough (principle 4); the menu
      // stays interactive at that opacity so Reactivate is still reachable.
      className={cn('flex flex-col gap-3 p-4', user.status === 'deactivated' && 'opacity-60')}
    >
      <div className="flex items-start gap-3">
        <Avatar
          name={user.displayName}
          className={cn('size-9', isSelf && 'bg-primary text-primary-foreground')}
        />
        <div className="min-w-0 flex-1">
          {/* dir="auto" so a Hebrew name/email reads correctly inside an English UI and vice
              versa; the email truncates rather than wrapping the row. */}
          <p className="truncate font-semibold text-foreground" dir="auto">
            {user.displayName}
          </p>
          <p className="truncate text-sm text-muted-foreground" dir="auto">
            {user.email}
          </p>
        </div>

        {hasActions ? (
          <DropdownMenu
            label={t('users.rowMenu', { name: user.displayName })}
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={t('users.rowMenu', { name: user.displayName })}
                className="-me-2 -mt-2 shrink-0"
              >
                <Icon name="overflow" />
              </Button>
            )}
          >
            {canActOnInvite ? (
              <>
                <DropdownMenuItem disabled={busy} onSelect={() => run(resend.mutate)}>
                  <Icon name="resend-invite" size="sm" />
                  {t('users.resend')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  tone="destructive"
                  disabled={busy}
                  onSelect={() => run(revoke.mutate)}
                >
                  <Icon name="revoke-invite" size="sm" />
                  {t('users.revoke')}
                </DropdownMenuItem>
              </>
            ) : null}

            {canDeactivate ? (
              // The destructive confirm routes through an AlertDialog, per the spec — the menu
              // row only opens it; the write fires from the dialog's confirm.
              <DropdownMenuItem
                tone="destructive"
                disabled={busy}
                onSelect={() => setConfirmOpen(true)}
              >
                <Icon name="deactivate-user" size="sm" />
                {t('users.deactivate')}
              </DropdownMenuItem>
            ) : null}

            {canReactivate ? (
              <DropdownMenuItem disabled={busy} onSelect={() => run(reactivate.mutate)}>
                <Icon name="reactivate-user" size="sm" />
                {t('users.reactivate')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenu>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <Badge variant={statusVariant[user.status]}>{t(statusLabelKey(user.status))}</Badge>
        <span>{t(roleLabelKey(user.role))}</span>
        {/* The location is admin-only (a manager's list is one Location, so the same value on
            every row is noise) and always a resolved name — `Chain-wide` for a location-less
            admin, never the raw uuid the shipped screen exposed. */}
        {isAdmin ? (
          <span dir="auto">· {user.locationName ?? t('users.locationChainWide')}</span>
        ) : null}
      </div>

      {actionFailed ? <p className="text-xs text-destructive">{t('users.actionFailed')}</p> : null}

      <AlertDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          run(deactivate.mutate)
        }}
        title={t('users.deactivateConfirmTitle', { name: user.displayName })}
        description={t('users.deactivateConfirmBody')}
        confirmLabel={t('users.deactivate')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={busy}
      />
    </Card>
  )
}
