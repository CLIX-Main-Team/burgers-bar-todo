import { type PrincipalResponse, isSuperAdmin } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { authApi, tasksApi } from '../../lib/api.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { isOverdue } from '../tasks/due-date.js'
import { sharedTasks } from '../tasks/task-filters.js'
import { BranchDisc } from './branch-disc.js'
import { LocationForm } from './location-form.js'
import { useLocations } from './use-locations.js'

// The admin-tier Locations surface, recut to The Counter (round 8, 2026-08-14): three
// summary tiles (branches, people, open tasks), then one row per branch: the name the app
// actually stores (no invented address line), who manages it, its headcount, and its open
// work. A super_admin sees the whole chain here; a branch admin reaches the same screen
// (2026-08-23: admin narrowed to a branch) and sees only their own row, since the /locations
// read is scoped the same way every other admin-tier read is (ADR-0007). Add branch is a
// chain-wide act — creating a branch, not managing one you already have — so it renders for a
// super_admin only. Gated by the route (RequireAdmin) with the API the real authority.
//
// Two shells (owner ask 2026-08-16, from a phone where the table ran off the screen): the
// table is desktop-only, and the phone reads the same branches as card rows that fit the
// width — nothing scrolls sideways on either. Since round 12 the row itself is a route, not a
// Dialog opener: it opens the branch's own page (Task 3), where rename and delete now live in
// edit mode and the danger zone. It is the People roster's grammar (user-list.tsx), which
// this screen sits beside.
//
// The counts join the two reads the viewer is already entitled to — the people list and
// the board, each scoped identically to the branch list itself — client-side; no new API.
export function LocationManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const canManageChain = isSuperAdmin(principal.role)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  const query = useLocations()
  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  const boardQuery = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })

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
  const peopleByLocation = new Map<string, number>()
  for (const user of users) {
    if (user.locationId === null) continue
    peopleByLocation.set(user.locationId, (peopleByLocation.get(user.locationId) ?? 0) + 1)
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

  const needle = search.trim().toLowerCase()
  const visible = needle
    ? locations.filter((location) => location.name.toLowerCase().includes(needle))
    : locations

  return (
    <div className="flex flex-col gap-4.5">
      {/* The Counter header grammar: the name and count own the top; the search and the
          gold Add branch sit in the toolbar row beneath them. */}
      <div className="flex flex-col items-start gap-[13px]">
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
        <>
          {/* Desktop: the data table, one bordered card surface. Each row is a single Link
              stretched over the whole row (the `after` overlay), so a click anywhere on it
              opens the branch's own page and a keyboard reaches it in one tab stop. */}
          <div className="hidden rounded-xl border border-border bg-card shadow-sm md:block">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {/* 34% to 28%: the admin column has to come from somewhere, and the branch
                      cell is the one carrying two lines of its own. */}
                  <th className="w-[28%] px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('locations.colBranch')}
                  </th>
                  {/* Admin before manager: a branch admin outranks the manager on the two
                      things this screen is about, the branch record and its people. */}
                  <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('locations.colAdmin')}
                  </th>
                  <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('locations.colManager')}
                  </th>
                  <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('locations.colPeople')}
                  </th>
                  <th className="px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                    {t('locations.colOpenTasks')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((location) => {
                  const admins = adminsByLocation.get(location.id) ?? []
                  const managers = managersByLocation.get(location.id) ?? []
                  const overdueCount = overdueByLocation.get(location.id) ?? 0
                  return (
                    <tr
                      key={location.id}
                      className="relative border-b border-border last:border-b-0 hover:bg-muted/40 has-[a:focus-visible]:bg-muted/40"
                    >
                      <td className="px-4 py-[11px]">
                        <div className="flex items-center gap-[11px]">
                          <BranchDisc name={location.name} />
                          <div className="min-w-0">
                            <Link
                              to={`/locations/${location.id}`}
                              aria-label={t('locations.rowMenu', { name: location.name })}
                              className="block truncate font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              dir="auto"
                            >
                              {location.name}
                            </Link>
                            {location.city ? (
                              <span
                                className="block truncate text-caption text-muted-foreground"
                                dir="auto"
                              >
                                {location.city}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      {/* A branch with no admin is not a tidy blank: it is a branch nobody is
                          accountable for, and after the role split that is a real gap for the
                          owner to close. It reads the same "Unassigned" the manager cell has
                          always used rather than inventing a second word for the same absence. */}
                      <td className="px-4 py-[11px]" dir="auto">
                        {admins.length > 0 ? (
                          admins.join(', ')
                        ) : (
                          <span className="text-muted-foreground">{t('locations.unassigned')}</span>
                        )}
                      </td>
                      <td className="px-4 py-[11px]" dir="auto">
                        {managers.length > 0 ? (
                          managers.join(', ')
                        ) : (
                          <span className="text-muted-foreground">{t('locations.unassigned')}</span>
                        )}
                      </td>
                      <td className="px-4 py-[11px] tabular-nums">
                        {peopleByLocation.get(location.id) ?? 0}
                      </td>
                      <td className="px-4 py-[11px] tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{openByLocation.get(location.id) ?? 0}</span>
                          {overdueCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <Icon name="overdue" size="sm" className="size-4" />
                              {overdueCount}
                              <span className="sr-only">{t('locations.colOverdue')}</span>
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: the same branches as card rows that fit the width — the disc, the name,
              and the admin, city, headcount and open work on one quiet line beneath it. The
              whole card is the Link.

              One name here, not two. The desktop table shows admin and manager in their own
              columns; a phone line already carrying a city and three counts cannot take a
              second name without pushing the counts out of sight, and the counts are what the
              line is scanned for. So the phone shows the accountable one — which is the same
              precedence the table states by putting admin first. */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {visible.map((location) => {
              const admins = adminsByLocation.get(location.id) ?? []
              const overdueCount = overdueByLocation.get(location.id) ?? 0
              const sub = [
                admins.length > 0 ? admins.join(', ') : t('locations.unassigned'),
                location.city,
                t('locations.peopleOnBranch', { count: peopleByLocation.get(location.id) ?? 0 }),
                t('locations.openTasksOnBranch', { count: openByLocation.get(location.id) ?? 0 }),
                overdueCount > 0 ? t('locations.overdueOnBranch', { count: overdueCount }) : null,
              ]
                .filter((part): part is string => Boolean(part))
                .join(' · ')
              return (
                <li key={location.id}>
                  <Link
                    to={`/locations/${location.id}`}
                    aria-label={t('locations.rowMenu', { name: location.name })}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-[11px] text-start shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <BranchDisc name={location.name} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-body font-semibold text-foreground"
                        dir="auto"
                      >
                        {location.name}
                      </span>
                      <span
                        className="block truncate text-caption text-muted-foreground"
                        dir="auto"
                      >
                        {sub}
                      </span>
                    </span>
                    {/* The chevron says the row opens something; decorative, the branch name
                        labels the link. */}
                    <Icon
                      name="row-forward"
                      size="sm"
                      className="flex-none text-muted-foreground"
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
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
