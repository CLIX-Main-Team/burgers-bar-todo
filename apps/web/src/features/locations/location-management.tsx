import { type Location, type PrincipalResponse, isSuperAdmin } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Dialog } from '../../components/ui/dialog.js'
import { Field } from '../../components/ui/field.js'
import { Icon } from '../../components/ui/icon.js'
import { Input } from '../../components/ui/input.js'
import { ApiError, authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { LocationForm } from './location-form.js'
import { LOCATIONS_QUERY_KEY, useLocations } from './use-locations.js'

// The admin-tier Locations surface, recut to The Counter (round 8, 2026-08-14): three
// summary tiles (branches, people, open tasks), then one row per branch: the name the app
// actually stores (no invented address line), who manages it, its headcount, and its open
// work. A super_admin sees the whole chain here; a branch admin reaches the same screen
// (2026-08-23: admin narrowed to a branch) and sees only their own row, since the /locations
// read is scoped the same way every other admin-tier read is (ADR-0007). Add branch and the
// row Dialog's Delete are chain-wide acts — creating or removing a branch, not managing the
// one you already have — so both render for a super_admin only; a branch admin still opens
// their row to Rename. Gated by the route (RequireAdmin) with the API the real authority.
//
// Two shells (owner ask 2026-08-16, from a phone where the table ran off the screen): the
// table is desktop-only, and the phone reads the same branches as card rows that fit the
// width — nothing scrolls sideways on either. The row's ⋯ menu is gone with the same ask;
// the row itself is the control now, opening the branch's actions (rename, delete) in a
// Dialog titled with the branch. It is the People roster's grammar (user-list.tsx), which
// this screen sits beside.
//
// The counts join the two reads the viewer is already entitled to — the people list and
// the board, each scoped identically to the branch list itself — client-side; no new API.
export function LocationManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const canManageChain = isSuperAdmin(principal.role)
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  // The branch whose actions Dialog is open — the row is the control that sets it.
  const [openBranch, setOpenBranch] = useState<Location | null>(null)

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
          {/* Desktop: the data table, one bordered card surface. Each row is a single button
              stretched over the whole row (the `after` overlay), so a click anywhere on it
              opens the branch and a keyboard reaches it in one tab stop. */}
          <div className="hidden rounded-xl border border-border bg-card shadow-sm md:block">
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
                </tr>
              </thead>
              <tbody>
                {visible.map((location) => {
                  const managers = managersByLocation.get(location.id) ?? []
                  return (
                    <tr
                      key={location.id}
                      className="relative border-b border-border last:border-b-0 hover:bg-muted/40 has-[button:focus-visible]:bg-muted/40"
                    >
                      <td className="px-4 py-[11px]">
                        <div className="flex items-center gap-[11px]">
                          <BranchDisc name={location.name} />
                          <button
                            type="button"
                            aria-label={t('locations.rowMenu', { name: location.name })}
                            onClick={() => setOpenBranch(location)}
                            className="truncate font-semibold text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            dir="auto"
                          >
                            {location.name}
                          </button>
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Phone: the same branches as card rows that fit the width — the disc, the name,
              and the manager, headcount and open work on one quiet line beneath it. The whole
              card is the button. */}
          <ul className="flex flex-col gap-2.5 md:hidden">
            {visible.map((location) => {
              const managers = managersByLocation.get(location.id) ?? []
              const sub = [
                managers.length > 0 ? managers.join(', ') : t('locations.unassigned'),
                t('locations.peopleOnBranch', { count: peopleByLocation.get(location.id) ?? 0 }),
                t('locations.openTasksOnBranch', { count: openByLocation.get(location.id) ?? 0 }),
              ].join(' · ')
              return (
                <li key={location.id}>
                  <button
                    type="button"
                    aria-label={t('locations.rowMenu', { name: location.name })}
                    onClick={() => setOpenBranch(location)}
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
                        labels the button. */}
                    <Icon
                      name="row-forward"
                      size="sm"
                      className="flex-none text-muted-foreground"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t('locations.createHeading')}>
        <LocationForm onClose={() => setAddOpen(false)} />
      </Dialog>

      {openBranch ? (
        <BranchDialog
          location={openBranch}
          canDelete={canManageChain}
          onClose={() => setOpenBranch(null)}
        />
      ) : null}
    </div>
  )
}

// The branch's initial on the brand black in gold — the artifact's branch disc; decorative,
// the name beside it carries the meaning.
function BranchDisc({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      dir="auto"
      className={cn(
        'grid size-8 flex-none place-items-center rounded-full bg-nav-surface text-caption font-extrabold text-nav-gold',
        className,
      )}
    >
      {name.trim().charAt(0).toLocaleUpperCase()}
    </span>
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

// What the branch Dialog is showing: the two actions, the rename form, or the delete
// confirmation. One Dialog rather than three stacked ones, so opening a branch and acting on
// it is a single surface that swaps its contents.
type BranchView = 'actions' | 'rename' | 'delete'

// The branch's own Dialog, opened by its row (owner ask 2026-08-16, replacing the ⋯ menu).
// It leads with the branch name and what this viewer may do to a branch, and each action
// takes over the same Dialog rather than stacking a second one on top. Delete is a
// chain-wide act — removing a branch outright, not managing the one you run — so it renders
// only for a super_admin (2026-08-23); a branch admin still gets Rename.
function BranchDialog({
  location,
  canDelete,
  onClose,
}: { location: Location; canDelete: boolean; onClose: () => void }) {
  const t = useTranslations()
  const [view, setView] = useState<BranchView>('actions')

  const title =
    view === 'rename'
      ? t('locations.renameTitle')
      : view === 'delete'
        ? t('locations.deleteTitle')
        : location.name

  return (
    <Dialog open onClose={onClose} title={title}>
      {view === 'actions' ? (
        <div className="flex flex-col">
          <BranchAction
            icon="edit"
            label={t('locations.rename')}
            onClick={() => setView('rename')}
          />
          {canDelete ? (
            <BranchAction
              icon="delete"
              label={t('locations.delete')}
              tone="destructive"
              onClick={() => setView('delete')}
            />
          ) : null}
        </div>
      ) : view === 'rename' ? (
        <RenameForm location={location} onClose={onClose} />
      ) : (
        <DeleteConfirm location={location} onClose={onClose} onCancel={() => setView('actions')} />
      )}
    </Dialog>
  )
}

// One row of the branch Dialog's action list — a full-width menu row, the destructive one
// in the danger ink.
function BranchAction({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: 'edit' | 'delete'
  label: string
  tone?: 'destructive'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-11 items-center gap-2.5 rounded-md px-2.5 text-start text-body font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'destructive' ? 'text-destructive' : 'text-foreground',
      )}
    >
      <Icon name={icon} size="sm" />
      {label}
    </button>
  )
}

// Rename (The Counter): the same PATCH the inline editor made. Save invalidates so the new
// name is read back from the API rather than guessed; an empty or unchanged name simply
// closes without a call.
function RenameForm({ location, onClose }: { location: Location; onClose: () => void }) {
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
  )
}

// Delete (owner ask 2026-08-16), confirmed before anything is destroyed. A branch that still
// has people or tasks on it is refused by the API with a 409 — read by status, not guessed
// from the counts this screen holds — and that refusal is shown here as the instruction it
// is: move them first. The branch stays open in that case, so the admin can act on it.
function DeleteConfirm({
  location,
  onClose,
  onCancel,
}: { location: Location; onClose: () => void; onCancel: () => void }) {
  const t = useTranslations()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<'in-use' | 'other' | null>(null)

  const remove = useMutation({
    mutationFn: () => locationsApi.remove(location.id),
    onSuccess: async () => {
      onClose()
      // The branch is gone from the list, and the roster's branch column and filters read
      // from it, so both invalidate.
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
      await queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
    onError: (error) => {
      setFailure(error instanceof ApiError && error.status === 409 ? 'in-use' : 'other')
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {failure === 'in-use' ? (
        <Alert tone="error">{t('locations.deleteInUse', { name: location.name })}</Alert>
      ) : failure === 'other' ? (
        <Alert tone="error">{t('locations.deleteFailed')}</Alert>
      ) : null}

      <p className="text-body text-muted-foreground" dir="auto">
        {t('locations.deleteBody', { name: location.name })}
      </p>

      <div className="mt-2 flex justify-end gap-2.5">
        <Button variant="outline" onClick={onCancel} disabled={remove.isPending}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setFailure(null)
            remove.mutate()
          }}
          disabled={remove.isPending}
        >
          {remove.isPending ? t('common.working') : t('locations.delete')}
        </Button>
      </div>
    </div>
  )
}
