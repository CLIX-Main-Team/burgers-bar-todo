import type { Location } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Field } from '../../components/ui/field.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { overflowTrigger } from '../tasks/task-menu.js'
import { LocationForm } from './location-form.js'
import { LOCATIONS_QUERY_KEY, useLocations } from './use-locations.js'

// The admin Locations surface, recut to The Counter (round 8, 2026-08-14): the chain at a
// glance — three summary tiles (branches, people, open tasks), then one table row per
// branch: the name the app actually stores (no invented address line), who manages it, its
// headcount, and its open work. Rename lives behind the row's ⋯ menu, and Add branch opens
// a Dialog — the inline create/rename cards are gone. Admin-only, gated by the route
// (RequireAdmin) with the API the real authority (ADR-0007).
//
// The counts join the two reads an admin is already entitled to — the chain-wide people
// list and the chain-wide board — client-side; no new API.
export function LocationManagement() {
  const t = useTranslations()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [renaming, setRenaming] = useState<Location | null>(null)

  const query = useLocations()
  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  const boardQuery = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })

  if (query.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.working')}</p>
  }
  if (query.isError) {
    return <Alert tone="error">{t('locations.loadFailed')}</Alert>
  }

  const locations = query.data
  const users = usersQuery.data?.users ?? []
  const tasks = boardQuery.data?.tasks ?? []

  const managersByLocation = new Map<string, string[]>()
  const peopleByLocation = new Map<string, number>()
  for (const user of users) {
    if (user.locationId === null) continue
    peopleByLocation.set(user.locationId, (peopleByLocation.get(user.locationId) ?? 0) + 1)
    if (user.role === 'manager') {
      const names = managersByLocation.get(user.locationId) ?? []
      names.push(user.displayName)
      managersByLocation.set(user.locationId, names)
    }
  }
  const openByLocation = new Map<string, number>()
  let openTotal = 0
  for (const task of tasks) {
    if (task.status === 'done') continue
    openTotal += 1
    openByLocation.set(task.locationId, (openByLocation.get(task.locationId) ?? 0) + 1)
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
          <Button size="sm" className="md:hidden" onClick={() => setAddOpen(true)}>
            <Icon name="create" size="sm" />
            {t('locations.addBranch')}
          </Button>
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
              className="h-9 ps-9 text-label md:text-label"
            />
          </div>
          <Button className="hidden md:inline-flex" onClick={() => setAddOpen(true)}>
            <Icon name="create" size="sm" />
            {t('locations.addBranch')}
          </Button>
        </div>
      </div>

      {/* The chain's summary tiles. */}
      <div className="flex flex-wrap gap-3">
        <StatTile value={locations.length} label={t('locations.statBranches')} />
        <StatTile value={users.length} label={t('locations.statPeople')} />
        <StatTile value={openTotal} label={t('locations.statOpenTasks')} />
      </div>

      {locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('locations.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('locations.searchNoMatches')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="w-[34%] px-4 py-[11px] text-start text-caption font-bold tracking-wider text-muted-foreground">
                  {t('locations.colBranch')}
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
                <th className="px-4 py-[11px]" />
              </tr>
            </thead>
            <tbody>
              {visible.map((location) => {
                const managers = managersByLocation.get(location.id) ?? []
                return (
                  <tr key={location.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-[11px]">
                      <div className="flex items-center gap-[11px]">
                        {/* The branch's initial on the brand black in gold — the artifact's
                            branch disc; decorative, the name beside it carries the meaning. */}
                        <span
                          aria-hidden
                          dir="auto"
                          className="grid size-8 flex-none place-items-center rounded-full bg-nav-surface text-caption font-extrabold text-nav-gold"
                        >
                          {location.name.trim().charAt(0).toLocaleUpperCase()}
                        </span>
                        <span className="truncate font-semibold text-foreground" dir="auto">
                          {location.name}
                        </span>
                      </div>
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
                      {openByLocation.get(location.id) ?? 0}
                    </td>
                    <td className="px-4 py-[11px] text-end">
                      <DropdownMenu
                        label={t('locations.rowMenu', { name: location.name })}
                        trigger={overflowTrigger(t('locations.rowMenu', { name: location.name }))}
                      >
                        <DropdownMenuItem onSelect={() => setRenaming(location)}>
                          <Icon name="edit" size="sm" />
                          {t('locations.rename')}
                        </DropdownMenuItem>
                      </DropdownMenu>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t('locations.createHeading')}>
        <LocationForm onClose={() => setAddOpen(false)} />
      </Dialog>

      {renaming ? <RenameDialog location={renaming} onClose={() => setRenaming(null)} /> : null}
    </div>
  )
}

// One summary number over its label — the artifact's stat tile.
function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-[8.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]">
      <p className="text-[1.375rem] leading-tight font-bold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-px text-caption text-muted-foreground">{label}</p>
    </div>
  )
}

// Rename, behind the row menu (The Counter): the same PATCH the inline editor made, now in
// the Dialog. Save invalidates so the new name is read back from the API rather than
// guessed; an empty or unchanged name simply closes without a call.
function RenameDialog({ location, onClose }: { location: Location; onClose: () => void }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(location.name)
  const [failed, setFailed] = useState(false)

  const rename = useMutation({
    mutationFn: (name: string) => locationsApi.rename(location.id, { name }),
    onSuccess: async () => {
      onClose()
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
    },
    onError: () => setFailed(true),
  })

  function save() {
    const name = draft.trim()
    if (!name || name === location.name) {
      onClose()
      return
    }
    setFailed(false)
    rename.mutate(name)
  }

  return (
    <Dialog open onClose={onClose} title={t('locations.renameTitle')}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        {failed ? <Alert tone="error">{t('locations.renameFailed')}</Alert> : null}
        <Field label={t('locations.name')}>
          {(props) => (
            <Input
              {...props}
              value={draft}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </Field>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose} disabled={rename.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={rename.isPending}>
            {rename.isPending ? t('common.working') : t('locations.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
