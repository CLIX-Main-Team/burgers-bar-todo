import type { Location, PrincipalResponse, Role, UserSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Avatar } from '../../components/ui/avatar.js'
import { Button } from '../../components/ui/button.js'
import { ApiError, authApi } from '../../lib/api.js'
import { InviteForm } from '../people/invite-form.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'

// The staffing chooser behind an unassigned slot (owner ask 2026-08-27): fill the slot by
// moving someone who already holds this role at another branch, or by inviting someone new
// with the role and branch pre-chosen. Two modes over one dialog rather than two dialogs,
// because the reader arrives with one question — "who runs this branch?" — and which answer
// they reach for depends on what the assign list turns out to hold.
//
// super_admin only, twice over: the slot UI offers the opener to no one else, and the
// /users/:id/assign endpoint refuses everyone else regardless (ADR-0007). The invite lane
// reuses the People page's own form untouched, so what an invite is — who may bake which
// role into which branch — stays written in exactly one place.
export function AssignDialogBody({
  branch,
  role,
  principal,
  onClose,
}: {
  branch: Location
  role: Role
  principal: PrincipalResponse
  onClose: () => void
}) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'assign' | 'invite'>('assign')
  const [failure, setFailure] = useState<string | null>(null)

  // The same users read the page already holds; the filter is the slot's own question. A
  // deactivated account is not offered — moving someone who cannot sign in fills nothing.
  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  const candidates = (usersQuery.data?.users ?? []).filter(
    (user) => user.role === role && user.locationId !== branch.id && user.status !== 'deactivated',
  )

  const mutation = useMutation({
    mutationFn: (userId: string) => authApi.assignUser(userId, { locationId: branch.id }),
    onSuccess: async () => {
      // The people list is the one source every consumer of "who works where" reads —
      // the slots, the roster, the index cards — so one invalidation reaches them all.
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
      onClose()
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 403) return setFailure(t('locations.forbidden'))
        if (error.status === 0) return setFailure(t('common.networkError'))
      }
      setFailure(t('locations.assignFailed'))
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {/* The two lanes as a small segmented row, the active one filled. */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'assign' ? 'primary' : 'outline'}
          onClick={() => setMode('assign')}
        >
          {t('locations.assignExisting')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'invite' ? 'primary' : 'outline'}
          onClick={() => setMode('invite')}
        >
          {t('locations.inviteNew')}
        </Button>
      </div>

      {mode === 'invite' ? (
        <InviteForm
          principal={principal}
          onClose={onClose}
          initialRole={role}
          initialLocationId={branch.id}
        />
      ) : (
        <>
          {failure ? <Alert tone="error">{failure}</Alert> : null}
          {usersQuery.isPending ? (
            <p className="text-body text-muted-foreground">{t('common.working')}</p>
          ) : candidates.length === 0 ? (
            <p className="text-body text-muted-foreground">{t('locations.assignEmpty')}</p>
          ) : (
            <ul className="flex max-h-[19rem] flex-col overflow-y-auto overscroll-contain pe-1">
              {candidates.map((person) => (
                <CandidateRow
                  key={person.id}
                  person={person}
                  pending={mutation.isPending}
                  onAssign={() => {
                    setFailure(null)
                    mutation.mutate(person.id)
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// One person the slot could take: who they are, where they are now, and the move. The current
// branch is stated on every row because it is the cost of the click — assigning here is
// removing them from there, and the reader should not have to remember which branch that is.
function CandidateRow({
  person,
  pending,
  onAssign,
}: { person: UserSummary; pending: boolean; onAssign: () => void }) {
  const t = useTranslations()
  return (
    <li className="flex min-h-12 items-center gap-2.5 border-b border-border py-1.5 last:border-b-0">
      <Avatar name={person.displayName} className="size-7 flex-none" />
      <span className="min-w-0 flex-1">
        {/* <bdi>, not dir="auto": on a block span auto-direction re-ALIGNS Hebrew to the far
            edge and the caption drifts away from the name (the dir-auto column trap,
            2026-08-24). <bdi> isolates the script without moving the text. */}
        <span className="block truncate text-body text-foreground">
          <bdi>{person.displayName}</bdi>
        </span>
        {person.locationName ? (
          <span className="block truncate text-caption text-muted-foreground">
            <bdi>{person.locationName}</bdi>
          </span>
        ) : null}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="flex-none"
        disabled={pending}
        onClick={onAssign}
      >
        {t('locations.assignAction')}
      </Button>
    </li>
  )
}
