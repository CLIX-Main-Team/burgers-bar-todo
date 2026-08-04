import type { PrincipalResponse, UserStatus, UserSummary } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Field } from '../../components/ui/field.js'
import type { IconRole } from '../../components/ui/icon-registry.js'
import { Icon } from '../../components/ui/icon.js'
import { Select, type SelectOption } from '../../components/ui/select.js'
import { sectionEmptyKey, statusLabelKey } from '../../i18n/labels.js'
import { authApi } from '../../lib/api.js'
import { PersonCard } from './person-card.js'
import { RosterEmpty, RosterError, RosterLoading } from './roster-states.js'
import { USERS_QUERY_KEY } from './users-query.js'

// Re-exported so the invite form keeps its `import { USERS_QUERY_KEY } from './user-list.js'`
// path; the key itself now lives in its own module so the list and the cards it renders can
// both read it without a cycle.
export { USERS_QUERY_KEY }

// The roster reads the way a person reasons about it: who is still pending, who is on, who is
// off. Fixed order so the three sections never reshuffle between renders (story 13).
const SECTIONS: readonly UserStatus[] = ['invited', 'active', 'deactivated']

// One glyph per status section header (mockup #179) — the single place status maps to its
// section marker, mirroring labels.ts's status→message-key. A new status adds one row here.
const USER_STATUS_ICON = {
  invited: 'people-invited',
  active: 'people-active',
  deactivated: 'people-deactivated',
} satisfies Record<UserStatus, IconRole>

// The admin Location filter's two reserved option values, kept out of the uuid space a real
// Location id occupies: ALL is the unfiltered default, CHAIN_WIDE the bucket a location-less
// (chain-wide) admin falls into.
const FILTER_ALL = 'all'
const FILTER_CHAIN_WIDE = 'chain-wide'

// The scoped, sectioned people roster in the flagship's card language (people build, Slice A,
// mockup #179). The list scope is derived server-side from the principal, never requested here
// (ADR-0007): an admin sees every user across every Location, a manager only their own. What
// differs by audience is presentation — the admin's chain-wide list carries a named-Location
// line on each card and a Location filter, while a manager's single-Location list drops both
// as redundant.
export function UserList({
  principal,
  onInvite,
}: {
  principal: PrincipalResponse
  // Opens the invite affordance from the empty-state CTA. Optional so the roster renders
  // standalone; the current stacked frame wires it to the invite form above the list.
  onInvite?: () => void
}) {
  const t = useTranslations()
  const isAdmin = principal.role === 'admin'
  const query = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  // The admin's Location filter is a client-side narrowing of the already-scoped list, so no
  // query parameter and no extra request. A manager never sees the control, so the state sits
  // unused for them.
  const [locationFilter, setLocationFilter] = useState(FILTER_ALL)

  if (query.isPending) {
    return <RosterLoading />
  }
  if (query.isError) {
    return <RosterError onRetry={() => query.refetch()} />
  }

  const users = query.data.users
  if (users.length === 0) {
    return <RosterEmpty onInvite={onInvite} />
  }

  // The filter options are the distinct Locations actually present in the list, each shown by
  // its resolved name (never the raw uuid), plus a chain-wide bucket only when a location-less
  // admin is in view. Built from the same scoped list, so the control never offers a Location
  // that would filter to nothing.
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
              label={t('users.filterLocation')}
              value={locationFilter}
              onValueChange={setLocationFilter}
              options={locationOptions}
            />
          )}
        </Field>
      ) : null}

      {SECTIONS.map((status) => (
        <UserSection
          key={status}
          status={status}
          users={visible.filter((user) => user.status === status)}
          isAdmin={isAdmin}
          selfId={principal.userId}
        />
      ))}
    </div>
  )
}

// One status section: its header (glyph + label + tabular count) and either the person cards
// in it or an explicit empty line, so "no one invited" reads as a state rather than a vanished
// section (story 13).
function UserSection({
  status,
  users,
  isAdmin,
  selfId,
}: {
  status: UserStatus
  users: UserSummary[]
  isAdmin: boolean
  selfId: string
}) {
  const t = useTranslations()
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon name={USER_STATUS_ICON[status]} size="sm" className="text-muted-foreground" />
        {t(statusLabelKey(status))}
        <span className="ms-auto text-xs font-normal tabular-nums text-muted-foreground">
          {users.length}
        </span>
      </h3>
      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(sectionEmptyKey(status))}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((user) => (
            <PersonCard key={user.id} user={user} isAdmin={isAdmin} isSelf={user.id === selfId} />
          ))}
        </div>
      )}
    </section>
  )
}
