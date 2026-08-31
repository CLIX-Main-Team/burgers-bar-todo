import { type PrincipalResponse, isSuperAdmin } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { type CSSProperties, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { useProjects } from '../projects/project-queries.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { isOverdue } from '../tasks/due-date.js'
import { sharedTasks } from '../tasks/task-filters.js'
import { BranchCard } from './branch-card.js'
import { LocationForm } from './location-form.js'
import { useLocations } from './use-locations.js'

// The admin-tier Locations surface: three summary tiles (branches, people, open tasks), then
// one BOX per branch (owner ask 2026-08-26, round 13, naming the Access page as the reference),
// carrying its admin, its manager, its people, its open work and its projects. A super_admin
// sees the whole chain here; a branch admin reaches the same screen (2026-08-23: admin narrowed
// to a branch) and sees only their own branch, since the /locations read is scoped the same way
// every other admin-tier read is (ADR-0007). Add branch is a chain-wide act — creating a branch,
// not managing one you already have — so it renders for a super_admin only. Gated by the route
// (RequireAdmin) with the API the real authority.
//
// The boxes replaced two shells that said the same thing twice: a desktop table and a separate
// phone card list, kept in step by hand since 2026-08-16 and already drifting (the phone showed
// one name where the table showed two). One grid reflows from one column to three, so there is
// now a single answer to what a branch looks like. The box itself is branch-card.tsx.
//
// Every number joins reads the viewer is already entitled to — the people list, the board and
// the project list, each scoped identically to the branch list itself — client-side; no new API.
export function LocationManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const canManageChain = isSuperAdmin(principal.role)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const query = useLocations()
  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  const boardQuery = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })
  const projectsQuery = useProjects()

  if (query.isPending) {
    return <p className="text-body text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('locations.loadFailed')}</Alert>
  }

  const locations = query.data
  const users = usersQuery.data?.users ?? []
  // Branch tallies count the branch's work, never the viewer's own private rows (2026-08-25).
  const tasks = sharedTasks(boardQuery.data?.tasks ?? [])
  const now = new Date()

  // Who runs each branch, in two ranks. The admin column arrived with the role split (owner
  // ask 2026-08-23): an admin used to be chain-wide and so belonged to no row on this table,
  // and now owns exactly one branch, which makes "who is accountable for this one" a fact the
  // list can finally state. A super_admin never appears here — they hold no branch, which is
  // the whole distinction — so this map only ever collects the branch admins.
  const adminsByLocation = new Map<string, string[]>()
  const managersByLocation = new Map<string, string[]>()
  // Names, not a tally: the box draws the branch's people as faces and needs to know whose.
  // The count it prints is this list's length, so the two can never disagree.
  const peopleByLocation = new Map<string, string[]>()
  for (const user of users) {
    if (user.locationId === null) continue
    const roster = peopleByLocation.get(user.locationId) ?? []
    roster.push(user.displayName)
    peopleByLocation.set(user.locationId, roster)
    if (user.role === 'admin') {
      const names = adminsByLocation.get(user.locationId) ?? []
      names.push(user.displayName)
      adminsByLocation.set(user.locationId, names)
    }
    if (user.role === 'manager') {
      const names = managersByLocation.get(user.locationId) ?? []
      names.push(user.displayName)
      managersByLocation.set(user.locationId, names)
    }
  }
  const openByLocation = new Map<string, number>()
  const overdueByLocation = new Map<string, number>()
  let openTotal = 0
  for (const task of tasks) {
    if (task.status === 'done') continue
    openTotal += 1
    openByLocation.set(task.locationId, (openByLocation.get(task.locationId) ?? 0) + 1)
    if (isOverdue(task.dueDate, task.status, now)) {
      overdueByLocation.set(task.locationId, (overdueByLocation.get(task.locationId) ?? 0) + 1)
    }
  }

  // Projects per branch (owner call 2026-08-26): the ones this branch is NAMED on, and only
  // while they are still running. A project with no branches named is chain-wide and is left
  // out on purpose — counting it would add the same baseline to every box and make the number
  // say less the more of them there are, when the point of the number is what is unique here.
  // "Still running" is the phase somebody set, not the checklist's derived status: a project is
  // over when the person running it says it is over.
  const projectsByLocation = new Map<string, number>()
  for (const project of projectsQuery.data?.projects ?? []) {
    if (project.phase === 'completed') continue
    for (const branch of project.locations) {
      projectsByLocation.set(branch.id, (projectsByLocation.get(branch.id) ?? 0) + 1)
    }
  }

  const needle = search.trim().toLowerCase()
  // Search answers to the name or to the chain's branch number, since the client asks for a
  // branch either way ("herzliya" or "15").
  const visible = needle
    ? locations.filter(
        (location) =>
          location.name.toLowerCase().includes(needle) ||
          (location.number !== null && String(location.number).includes(needle)),
      )
    : locations

  return (
    <div className="flex flex-col gap-4.5">
      {/* The Counter header grammar: the name and count own the top; the search and the
          gold Add branch sit in the toolbar row beneath them. */}
      <div className="flex flex-col items-start gap-[13px] motion-safe:animate-rise">
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <h1 className="text-heading-lg font-extrabold text-foreground">
              {t('locations.heading')}
            </h1>
            <p className="mt-0.5 text-label text-muted-foreground">
              {t('locations.branchCount', { count: locations.length })}
            </p>
          </div>
          {canManageChain ? (
            <Button size="sm" className="md:hidden" onClick={() => setAddOpen(true)}>
              <Icon name="create" size="sm" />
              {t('locations.addBranch')}
            </Button>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-[9px]">
          <div className="relative w-full md:w-[200px]">
            <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted-foreground">
              <Icon name="search" size="sm" />
            </span>
            <Input
              type="search"
              aria-label={t('locations.searchPlaceholder')}
              placeholder={t('locations.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 ps-9 md:h-9 md:text-label"
            />
          </div>
          {canManageChain ? (
            <Button className="hidden md:inline-flex" onClick={() => setAddOpen(true)}>
              <Icon name="create" size="sm" />
              {t('locations.addBranch')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* The chain's summary tiles. */}
      <div className="flex flex-wrap gap-3">
        <StatTile value={locations.length} label={t('locations.statBranches')} />
        <StatTile value={users.length} label={t('locations.statPeople')} />
        <StatTile value={openTotal} label={t('locations.statOpenTasks')} />
      </div>

      {locations.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('locations.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="text-body text-muted-foreground">{t('locations.searchNoMatches')}</p>
      ) : (
        <ul
          className="bb-stagger grid auto-rows-fr gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
          style={{ '--bb-stagger-base': '80ms' } as CSSProperties}
        >
          {visible.map((location) => (
            <BranchCard
              key={location.id}
              id={location.id}
              name={location.name}
              number={location.number}
              city={location.city}
              adminNames={adminsByLocation.get(location.id) ?? []}
              managerNames={managersByLocation.get(location.id) ?? []}
              peopleNames={peopleByLocation.get(location.id) ?? []}
              openTasks={openByLocation.get(location.id) ?? 0}
              overdueTasks={overdueByLocation.get(location.id) ?? 0}
              projects={projectsByLocation.get(location.id) ?? 0}
            />
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t('locations.createHeading')}>
        <LocationForm onClose={() => setAddOpen(false)} />
      </Dialog>
    </div>
  )
}

// One summary number over its label — the artifact's stat tile. The floor is 120px rather
// than the artifact's 136: the nav rail widened to 80px in round 10 so its longest labels
// would stop clipping, and at 136 a phone could no longer hold two tiles side by side.
function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[7.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]">
      <p className="text-display leading-tight font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-px text-caption text-muted-foreground">{label}</p>
    </div>
  )
}
