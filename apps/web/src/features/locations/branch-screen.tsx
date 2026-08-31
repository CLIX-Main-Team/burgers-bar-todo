import { type Location, type PrincipalResponse, isSuperAdmin } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { hasCapability } from '../../auth/roles.js'
import { useSession } from '../../auth/session.js'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Skeleton } from '../../components/ui/skeleton.js'
import { ApiError, authApi, locationsApi, tasksApi } from '../../lib/api.js'
import { shiftMetrics } from '../dashboard/dashboard-metrics.js'
import { USERS_QUERY_KEY } from '../people/users-query.js'
import { TASKS_QUERY_KEY } from '../tasks/board-stream.js'
import { sharedTasks } from '../tasks/task-filters.js'
import { OpenWorkPanel, StaffingPanel } from './branch-panels.js'
import { BranchPlate } from './branch-plate.js'
import { BranchTiles } from './branch-tiles.js'
import { LOCATIONS_QUERY_KEY, useLocation, useLocations } from './use-locations.js'

// The branch detail page, `/locations/:id` (round 12). It is the Dashboard's small sibling:
// the same tiles, the same card grammar, the same arithmetic — `shiftMetrics` over this
// branch's slice of the board — so the chain view and the branch view can never disagree
// about a number. What it adds is the plate at the top, which turns into its own edit form
// in place (branch-plate.tsx), and the danger zone at the bottom.
//
// It reads nothing new. The branch record, the people list and the board are three queries
// the viewer already holds on this session's caches, each scoped by the API from the
// principal (ADR-0007) — which makes the page role-shaped for free: a branch admin reaching
// their own branch reads exactly their own branch, and a super_admin reaches any of them.
// No detail endpoint was added for this screen.
export function BranchScreen() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before any shell route renders; narrow the type.
  if (!principal) {
    return null
  }

  return <BranchDetail principal={principal} />
}

export function BranchDetail({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const { id = '' } = useParams<{ id: string }>()

  // Two hooks, one request: both sit on LOCATIONS_QUERY_KEY, so React Query serves them from
  // the same cache entry. `useLocation` resolves to the record (or null once the list has
  // settled without it) and carries no status of its own, so the list query beside it is
  // what tells a still-loading page from an unreachable API.
  const listQuery = useLocations()
  const branch = useLocation(id)
  const usersQuery = useQuery({ queryKey: USERS_QUERY_KEY, queryFn: authApi.listUsers })
  const boardQuery = useQuery({ queryKey: TASKS_QUERY_KEY, queryFn: tasksApi.board })

  if (listQuery.isError) {
    return (
      <div className="flex flex-col gap-4">
        <BackToBranches />
        <Alert tone="error">{t('locations.loadFailed')}</Alert>
      </div>
    )
  }

  // A silhouette of the page rather than a spinner, so nothing jumps when the three reads
  // land — and they land at different moments, which is exactly when a spinner looks broken.
  if (listQuery.isPending || usersQuery.isPending || boardQuery.isPending) {
    return <BranchLoading />
  }

  // The list has settled and does not carry this branch. For a branch admin asking after
  // somebody else's branch that is the honest answer and not an error: the API answers 404
  // rather than 403 precisely so the chain cannot be mapped by walking ids (spec 1.4).
  if (!branch) {
    return (
      <div className="flex flex-col gap-4">
        <BackToBranches />
        <p className="max-w-[46rem] text-body text-muted-foreground">{t('locations.notFound')}</p>
      </div>
    )
  }

  const people = (usersQuery.data?.users ?? []).filter((user) => user.locationId === branch.id)
  // A private task carries no branch at all, so this filter would drop it anyway; going through
  // sharedTasks says so on purpose rather than relying on that (2026-08-25).
  const branchTasks = sharedTasks(boardQuery.data?.tasks ?? []).filter(
    (task) => task.locationId === branch.id,
  )
  const metrics = shiftMetrics(branchTasks, new Date())
  const openTasks = branchTasks.filter((task) => task.status !== 'done')

  // The way back only exists for someone who came from a list. A viewer who holds one branch is
  // sent straight here by /locations (locations-screen.tsx), so a back link would bounce them
  // right back to the page they are on.
  const fromList = isSuperAdmin(principal.role)

  return (
    // The page arrives as its own blocks — the way back, the plate, the tiles, then the two
    // lists — 40ms apart. See .bb-stagger in index.css.
    <div className="bb-stagger flex flex-col gap-4.5">
      {fromList ? <BackToBranches /> : null}
      {/* Two separate authorities, both presentation gating over an API that refuses the call
          either way (ADR-0007). Editing the record is locations.manage, which a manager does not
          hold — they read this page (2026-08-25). Destroying the branch is chain-wide and what
          separates the owner from a branch admin (spec decision 4), so a branch admin's plate
          simply has no third control in its footer. */}
      <BranchPlate
        branch={branch}
        editable={hasCapability(principal, 'locations.manage')}
        deleteAction={isSuperAdmin(principal.role) ? <DeleteBranchAction branch={branch} /> : null}
      />
      <BranchTiles people={people.length} metrics={metrics} />

      {/* Side by side where there is room, stacked on a phone. Two columns rather than the
          Dashboard's three: this page has exactly two lists and a half-empty third column
          would read as something missing. */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <StaffingPanel branch={branch} people={people} principal={principal} />
        <OpenWorkPanel tasks={openTasks} />
      </div>
    </div>
  )
}

function BackToBranches() {
  const t = useTranslations()
  return (
    <Link
      to="/locations"
      className="inline-flex min-h-11 items-center gap-1 self-start text-label font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
    >
      {/* `back` is a directional role, so the arrow mirrors with the reading direction on
          its own and this call site never asks which way the page is running. */}
      <Icon name="back" size="sm" />
      {t('locations.backToBranches')}
    </Link>
  )
}

// The page's own silhouette: the plate, the four tiles, the two panels. Shaped like what is
// coming rather than sized at random, so the real page settles into the space it reserved.
function BranchLoading() {
  const t = useTranslations()
  return (
    <div
      aria-busy="true"
      aria-label={t('locations.branchLoading')}
      className="flex flex-col gap-4.5"
    >
      <Skeleton className="h-4 w-20" />
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-11 flex-none rounded-full" />
          <div className="min-w-0 flex-1 flex-col">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="mt-2 h-3.5 w-56" />
            <Skeleton className="mt-2 h-3.5 w-32" />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {[0, 1, 2, 3].map((slot) => (
          <div
            key={slot}
            className="min-w-[7.5rem] flex-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[210px]"
          >
            <Skeleton className="h-6 w-12" />
            <Skeleton className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        {[0, 1].map((slot) => (
          <div
            key={slot}
            className="rounded-xl border border-border bg-card px-4 py-[15px] shadow-sm"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-3.5 w-full" />
            <Skeleton className="mt-3 h-3.5 w-4/5" />
            <Skeleton className="mt-3 h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Delete, rendered into the plate's edit footer (owner ask 2026-08-23) rather than a section
// of its own at the foot of the page. The refusal it has to survive is the API's own: a branch
// that still has people or tasks on it answers 409 `location_in_use`, read by status rather
// than guessed from the counts this page happens to be showing — the two can disagree, and the
// server is the one that knows.
function DeleteBranchAction({ branch }: { branch: Location }) {
  const t = useTranslations()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => locationsApi.remove(branch.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: LOCATIONS_QUERY_KEY })
      navigate('/locations')
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        // Not a failure to apologise for but an instruction to follow, so it names the branch
        // and says what to do next — and the page stays open so the reader can go do it.
        if (error.status === 409) {
          // Two different refusals wear the same status, and they send the reader to two
          // different screens: people and tasks are cleared from People and the board, a
          // project is detached on Projects. Naming the wrong one is worse than saying
          // nothing, so the code decides the sentence.
          return setFailure(
            error.code === 'location_in_project'
              ? t('locations.deleteInProject', { name: branch.name })
              : t('locations.deleteInUse', { name: branch.name }),
          )
        }
        if (error.status === 403) return setFailure(t('locations.forbidden'))
        if (error.status === 0) return setFailure(t('common.networkError'))
      }
      setFailure(t('locations.deleteFailed'))
    },
  })

  return (
    <>
      {/* The footer is a wrapping flex row, so a full-width item ordered first takes its own
          line above the controls rather than squeezing them. */}
      {failure ? (
        <Alert tone="error" className="order-first w-full">
          {failure}
        </Alert>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        // Quiet until you reach for it, the same treatment the task dialog's delete wears:
        // full destructive ink here would be the loudest thing on a page whose one bold
        // moment is the plate. The red belongs on the confirm, where the decision is.
        className="text-muted-foreground hover:text-destructive focus-visible:text-destructive"
        disabled={mutation.isPending}
        onClick={() => {
          setFailure(null)
          setConfirming(true)
        }}
      >
        <Icon name="delete" size="sm" />
        {t('locations.delete')}
      </Button>

      <AlertDialog
        open={confirming}
        title={t('locations.deleteTitle')}
        description={t('locations.deleteBody', { name: branch.name })}
        confirmLabel={t('locations.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={mutation.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          mutation.mutate()
        }}
      />
    </>
  )
}
