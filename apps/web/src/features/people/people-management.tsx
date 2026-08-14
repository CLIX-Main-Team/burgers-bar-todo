import type { PrincipalResponse, Role } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { InviteForm } from './invite-form.js'
import { RosterEmpty, RosterError, RosterLoading } from './roster-states.js'
import { UserList } from './user-list.js'
import { USERS_QUERY_KEY } from './users-query.js'

// The provisioning surface for an Admin or Manager, recut to The Counter (round 8,
// 2026-08-14): the page name over a toolbar of exactly three controls — a branch filter
// (admin only; a manager's roster is one branch), a role filter, and the gold Invite that
// opens the modal — above the roster table. The inline invite card is gone; inviting is a
// Dialog over the roster with the app's real fields. Both halves stay gated to
// admin/manager by the shell; the API enforces the finer scoping on every call (ADR-0007).

const FILTER_ALL = 'all'
const FILTER_CHAIN_WIDE = 'chain-wide'

const ROLE_FILTERS: readonly Role[] = ['admin', 'manager', 'employee']

export function PeopleManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const isAdmin = principal.role === 'admin'
  const [locationFilter, setLocationFilter] = useState(FILTER_ALL)
  const [roleFilter, setRoleFilter] = useState(FILTER_ALL)
  const [inviteOpen, setInviteOpen] = useState(false)

  const query = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  // The Open-tasks column joins the board read this writer is already entitled to: the
  // board's scope (chain for an admin, own branch for a manager) matches the roster's, so
  // counting each person's not-done assignments client-side needs no new API.
  const boardQuery = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })

  if (query.isPending) {
    return <RosterLoading />
  }
  if (query.isError) {
    return <RosterError onRetry={() => query.refetch()} />
  }

  const users = query.data.users

  const openTasks = new Map<string, number>()
  for (const task of boardQuery.data?.tasks ?? []) {
    if (task.status === 'done') continue
    for (const assignee of task.assignees) {
      openTasks.set(assignee.id, (openTasks.get(assignee.id) ?? 0) + 1)
    }
  }

  // The branch filter's options are the distinct Locations actually present in the scoped
  // list — resolved names, never uuids — plus a chain-wide bucket only when a location-less
  // admin is in view. Built from the same list, so the control never filters to nothing.
  const namedLocations = new Map<string, string>()
  let hasChainWide = false
  for (const user of users) {
    if (user.locationId === null) {
      hasChainWide = true
    } else {
      namedLocations.set(user.locationId, user.locationName ?? user.locationId)
    }
  }
  const locationOptions: SelectOption[] = [
    { value: FILTER_ALL, label: t('users.filterAllLocations') },
    ...Array.from(namedLocations, ([value, label]) => ({ value, label })),
    ...(hasChainWide ? [{ value: FILTER_CHAIN_WIDE, label: t('users.locationChainWide') }] : []),
  ]
  const roleOptions: SelectOption[] = [
    { value: FILTER_ALL, label: t('users.filterAllRoles') },
    ...ROLE_FILTERS.map((role) => ({ value: role, label: t(`invites.role${capitalize(role)}`) })),
  ]

  const visible = users.filter((user) => {
    if (roleFilter !== FILTER_ALL && user.role !== roleFilter) {
      return false
    }
    if (!isAdmin || locationFilter === FILTER_ALL) {
      return true
    }
    if (locationFilter === FILTER_CHAIN_WIDE) {
      return user.locationId === null
    }
    return user.locationId === locationFilter
  })

  // The subtitle counts what the viewer actually sees: an admin's chain across its branches,
  // a manager's single-branch headcount.
  const subtitle = isAdmin
    ? t('users.acrossBranches', { count: users.length, branches: namedLocations.size })
    : t('users.peopleCount', { count: users.length })

  // The toolbar's compact 40px trigger — the header-density control cut, not a form field.
  const filterTrigger =
    'h-10 rounded-md border border-border-strong bg-card px-3 text-label font-medium'

  const inviteButton = (className?: string) => (
    <Button size="sm" className={className} onClick={() => setInviteOpen(true)}>
      <Icon name="create" size="sm" />
      {t('users.invite')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* The Counter header grammar: the name owns its line; on desktop every control sits
          in the toolbar row beneath it, on the phone Invite rides the title row and the
          filters take their own row below. */}
      <div className="flex flex-col items-start gap-3">
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <h1 className="text-heading-lg font-extrabold text-foreground">{t('users.heading')}</h1>
            <p className="mt-0.5 text-caption text-muted-foreground">{subtitle}</p>
          </div>
          {inviteButton('md:hidden')}
        </div>

        <div className="flex w-full flex-wrap items-center gap-2">
          {isAdmin ? (
            <Select
              label={t('users.filterLocation')}
              value={locationFilter}
              onValueChange={setLocationFilter}
              options={locationOptions}
              triggerClassName={filterTrigger}
              className="min-w-0 flex-1 md:w-44 md:flex-none"
            />
          ) : null}
          <Select
            label={t('users.filterRole')}
            value={roleFilter}
            onValueChange={setRoleFilter}
            options={roleOptions}
            triggerClassName={filterTrigger}
            className="min-w-0 flex-1 md:w-40 md:flex-none"
          />
          {inviteButton('hidden h-10 md:inline-flex')}
        </div>
      </div>

      {users.length === 0 ? (
        <RosterEmpty onInvite={() => setInviteOpen(true)} />
      ) : (
        <UserList
          users={visible}
          openTasks={openTasks}
          isAdmin={isAdmin}
          selfId={principal.userId}
        />
      )}

      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('invites.title')}
        description={t('invites.subtitle')}
      >
        <InviteForm principal={principal} onClose={() => setInviteOpen(false)} />
      </Dialog>
    </div>
  )
}

function capitalize(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
