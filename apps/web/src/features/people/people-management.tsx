import { type PrincipalResponse, type Role, type Task, hasAdminAuthority } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { hasCapability } from '../../auth/roles.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { InviteForm } from './invite-form.js'
import { PersonDialog } from './person-dialog.js'
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

const ROLE_FILTERS: readonly Role[] = ['super_admin', 'admin', 'manager', 'employee']

// How often the open roster re-reads itself, so presence stays true while a manager watches
// it (round 12). It does double duty: the refetch brings in everyone's newer last-seen stamp,
// and the re-render it causes is what advances "5 minutes ago" to "6 minutes ago" without a
// second timer to keep in step. One minute matches both the API's own restamp interval and
// the board badge's poll (tasks/unseen.ts), so the roster is never staler than its source.
const ROSTER_REFETCH_MS = 60_000

export function PeopleManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const isAdmin = hasAdminAuthority(principal.role)
  // Chasing a pending invite rides people.invite since 2026-08-26, which a manager holds — so
  // it is asked of the capability list rather than inferred from the role, and the row menu
  // offers exactly what the API would accept.
  const canInvite = hasCapability(principal, 'people.invite')
  const [locationFilter, setLocationFilter] = useState(FILTER_ALL)
  const [roleFilter, setRoleFilter] = useState(FILTER_ALL)
  const [inviteOpen, setInviteOpen] = useState(false)
  // The person a row opened, held by id rather than by value so the dialog re-reads the fresh
  // row after a write: deactivating from inside it refetches the roster, and a captured object
  // would leave the header still claiming the person is active.
  const [openPersonId, setOpenPersonId] = useState<string | null>(null)
  const [actionFailed, setActionFailed] = useState(false)

  const query = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: authApi.listUsers,
    refetchInterval: ROSTER_REFETCH_MS,
    // The one query that overrides the client-wide refetchOnWindowFocus: false. That default
    // is off because the board is kept fresh by its SSE channel (tasks/board-stream.ts) — the
    // roster has no such channel, and presence is the only thing in the app that goes stale
    // just by time passing. Coming back to a tab left open over lunch should not greet a
    // manager with an hour-old "Online".
    refetchOnWindowFocus: true,
  })
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
  // One clock for the whole render: every row resolves presence against the same instant, so
  // two people either side of the online boundary can never disagree about where it fell.
  // Read here rather than in state because the refetch above is what re-renders this screen,
  // and it already ticks at the resolution presence is reported in.
  const now = Date.now()

  // Resolved from the list on every render, so the dialog always shows the row as the API last
  // reported it. A person who disappears from the viewer's scope (a revoked invite) closes the
  // dialog by simply not being found, rather than stranding it on a row that no longer exists.
  const openPerson = openPersonId ? users.find((user) => user.id === openPersonId) : undefined

  // The open tasks each person is carrying, keyed by user id. Held as the tasks themselves and
  // not just a tally, because the roster column wants the count and the person dialog wants the
  // rows — deriving the count from `.length` keeps the number on the tab identical to the number
  // in the row that opened it, which two separate structures would eventually let drift.
  const openTasks = new Map<string, Task[]>()
  for (const task of boardQuery.data?.tasks ?? []) {
    if (task.status === 'done') continue
    for (const assignee of task.assignees) {
      const carried = openTasks.get(assignee.id)
      if (carried) carried.push(task)
      else openTasks.set(assignee.id, [task])
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
    ...ROLE_FILTERS.map((role) => ({ value: role, label: t(roleLabelKey(role)) })),
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

  // The subtitle counts what the viewer actually sees: a super_admin's chain across its branches,
  // a branch admin's own branch counted the same way (it is just the one), a manager's
  // single-branch headcount.
  const subtitle = isAdmin
    ? t('users.acrossBranches', { count: users.length, branches: namedLocations.size })
    : t('users.peopleCount', { count: users.length })

  // The toolbar's compact 36px trigger — the header-density control cut, not a form field.
  const filterTrigger =
    'h-9 rounded-md border border-border-strong bg-card shadow-sm px-3 text-label font-medium'

  const inviteButton = (className?: string) => (
    <Button className={className} onClick={() => setInviteOpen(true)}>
      <Icon name="create" size="sm" />
      {t('users.invite')}
    </Button>
  )

  return (
    <div className="flex flex-col gap-4.5">
      {/* The Counter header grammar: the name owns its line; on desktop every control sits
          in the toolbar row beneath it, on the phone Invite rides the title row and the
          filters take their own row below. */}
      <div className="flex flex-col items-start gap-[13px]">
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <h1 className="text-heading-lg font-extrabold text-foreground">{t('users.heading')}</h1>
            <p className="mt-0.5 text-label text-muted-foreground">{subtitle}</p>
          </div>
          {inviteButton('md:hidden')}
        </div>

        <div className="flex w-full flex-wrap items-center gap-[9px]">
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
          {inviteButton('hidden md:inline-flex')}
        </div>
      </div>

      {actionFailed ? <Alert tone="error">{t('users.actionFailed')}</Alert> : null}

      {users.length === 0 ? (
        <RosterEmpty onInvite={() => setInviteOpen(true)} />
      ) : (
        <UserList
          users={visible}
          openTasks={openTasks}
          isAdmin={isAdmin}
          canInvite={canInvite}
          selfId={principal.userId}
          now={now}
          onOpen={(user) => setOpenPersonId(user.id)}
          onActionError={() => setActionFailed(true)}
        />
      )}

      {openPerson ? (
        <PersonDialog
          user={openPerson}
          tasks={openTasks.get(openPerson.id) ?? []}
          isAdmin={isAdmin}
          canInvite={canInvite}
          selfId={principal.userId}
          now={now}
          onClose={() => setOpenPersonId(null)}
          onActionError={() => setActionFailed(true)}
        />
      ) : null}

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
