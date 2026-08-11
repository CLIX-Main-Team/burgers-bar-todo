import type { ThreadSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { assistantApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { overflowTrigger } from '../tasks/task-menu.js'

// The one cache key the thread list reads and the screen invalidates: starting a new thread (#94)
// marks this stale so the next read shows it. React Query dedupes and caches by this key, so the two
// places this list appears — the desktop rail and the mobile/tablet Sheet — share one read, and a
// reopen paints the last-known list instantly then refetches.
export const THREADS_QUERY_KEY = ['threads'] as const

// Rows are grouped by how recently each conversation was touched, and each row then carries its
// title alone (owner call 2026-08-11, following the LLM chat sidebars): a date on every row is
// noise at rail width, while the group heading gives the same orientation once per bucket. Four
// buckets is as fine as this reads — the list is most-recently-active first, so a staff member is
// looking for "the one from this morning" or "the one from last week", not for a calendar date.
const BUCKETS = ['today', 'yesterday', 'previousWeek', 'older'] as const
type Bucket = (typeof BUCKETS)[number]

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'threadsToday',
  yesterday: 'threadsYesterday',
  previousWeek: 'threadsPreviousWeek',
  older: 'threadsOlder',
}

// Which bucket an instant falls in. Days are counted from local midnight so "yesterday" means the
// day before, not "24 hours ago"; rounding absorbs the hour a DST boundary adds or drops.
function bucketFor(iso: string, now: Date): Bucket {
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(new Date(iso))) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 7) return 'previousWeek'
  return 'older'
}

// The API already returns the threads most-recently-active first, so bucketing preserves that order
// within each group and the groups themselves come out newest-first. Empty buckets never render.
function groupByRecency(threads: readonly ThreadSummary[], now: Date) {
  return BUCKETS.map((bucket) => ({
    bucket,
    threads: threads.filter((thread) => bucketFor(thread.updatedAt, now) === bucket),
  })).filter((group) => group.threads.length > 0)
}

// The thread list contents (#94, #228, components.md §ThreadList): the New-conversation action over
// the caller's own auto-titled conversations, grouped by recency. It is rendered two ways by the
// assistant screen — as a persistent rail beside the side nav from `lg`, and as a bottom Sheet below
// it — but the contents are one component so the rows, states, and behaviours never fork.
//
// Each conversation is a row carrying its title alone, under a small recency heading (owner call
// 2026-08-11, drawn from how the LLM chat sidebars read): the rail's own ground is barely there,
// so these rows are what give the column its shape, and their hover and selected fills are the
// only surfaces in it. They are cut like the side nav's destination rows — the same radius step,
// inline padding, and selected treatment — because at the width where this is a rail the two
// columns stand side by side.
//
// The list is author-scoped by the API from the principal (ADR-0007) — the SPA never asks for a
// scope, and a response never carries another user's threads. Titles are the only thread text shown
// here; a question and an answer are read inside the conversation, not in the list. Every title is
// `dir="auto"` so a Hebrew conversation title reads correctly inside an English rail and the reverse.
export function ThreadList({
  activeThreadId,
  onSelect,
  onNewThread,
  onDeleted,
}: {
  activeThreadId: string | null
  onSelect(id: string): void
  onNewThread(): void
  // A thread the user deleted is gone (#257); the screen resets its view when it was the open one.
  onDeleted(id: string): void
}) {
  const t = useTranslations('assistant')
  const tCommon = useTranslations('common')
  const queryClient = useQueryClient()
  // Names each group's list from its own visible heading, unique per mount.
  const groupId = useId()
  const query = useQuery({ queryKey: THREADS_QUERY_KEY, queryFn: assistantApi.listThreads })

  // The delete flow (#257): the row's overflow menu asks, the AlertDialog confirms — the same
  // menu-then-dialog shape the managed task card uses — and the hard delete lands at the API,
  // which scopes it to the caller. On success the list refetches and the screen is told which
  // conversation is gone so it can reset if it was the open one.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => assistantApi.deleteThread(id),
    onSuccess: (_data, id) => {
      setConfirmingId(null)
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
      onDeleted(id)
    },
  })

  // One clock read per render: bucketing every row against the same instant keeps a list that
  // straddles midnight from splitting one day across two headings mid-map.
  const now = new Date()

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The list's single blue action (components.md §ThreadList): start fresh, resetting to the
          first-run state; the next question lazily creates the thread. */}
      <Button className="w-full justify-start gap-2" onClick={onNewThread}>
        {/* Leading glyph is decorative — the button text names the action. */}
        <Icon name="new-thread" />
        {t('newThread')}
      </Button>

      {/* The rows scroll independently so a long history never pushes the New-conversation action out
          of reach; in the Sheet the panel scrolls instead, and this stays unbounded. */}
      <nav aria-label={t('threadsListLabel')} className="min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          // Skeleton rows shaped like the real thread rows while the list loads (components.md
          // §ThreadList / §Skeleton); the label rides sr-only so assistive tech still hears it.
          <>
            <span className="sr-only">{t('threadsLoading')}</span>
            {/* The shapes use a muted-foreground tint, not `bg-muted`: this list renders on the
                desktop rail's washed-back ground as well as the Sheet's `card`, and a `bg-muted`
                skeleton (the DS Skeleton default) would all but vanish on the rail. The tint
                contrasts on both. */}
            <ul aria-hidden="true" className="flex flex-col gap-0.5">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex min-h-[var(--bb-touch-min)] items-center gap-2 px-2">
                  <span className="size-4 shrink-0 animate-pulse rounded-full bg-muted-foreground/20" />
                  <span className="h-4 flex-1 animate-pulse rounded bg-muted-foreground/20" />
                </li>
              ))}
            </ul>
          </>
        ) : query.isError ? (
          <Alert tone="error" className="mx-1">
            {t('threadsLoadFailed')}
          </Alert>
        ) : query.data.threads.length === 0 ? (
          <p className="px-2.5 py-1 text-sm text-muted-foreground">{t('threadsEmpty')}</p>
        ) : (
          <>
            {deleteMutation.isError ? (
              <Alert tone="error" className="mx-1 mb-1">
                {t('deleteThreadFailed')}
              </Alert>
            ) : null}
            {groupByRecency(query.data.threads, now).map((group) => (
              <div key={group.bucket} className="pb-3 last:pb-0">
                {/* Deliberately not a heading element: this list renders inside the Sheet, whose
                    own title is the h2, and inside the rail, where there is none — a heading here
                    would have no honest level in both. The list points its name at it instead. */}
                <p
                  id={`${groupId}-${group.bucket}`}
                  className="px-2.5 pb-1 text-caption font-semibold text-muted-foreground"
                >
                  {t(BUCKET_LABEL[group.bucket])}
                </p>
                <ul
                  aria-labelledby={`${groupId}-${group.bucket}`}
                  className="flex flex-col gap-0.5"
                >
                  {group.threads.map((thread) => {
                    const active = thread.id === activeThreadId
                    return (
                      // The row splits into the full-width open button and a trailing overflow menu
                      // — a button cannot nest inside a button, so the two are flex siblings, the
                      // same shape the task card resolves this with.
                      <li key={thread.id} className="group/row flex items-center gap-1">
                        <button
                          type="button"
                          // aria-current marks the conversation the reader is in — the list's one
                          // bit of selection state, and what assistive tech reads on the active row.
                          aria-current={active ? 'true' : undefined}
                          onClick={() => onSelect(thread.id)}
                          // Shaped like the side nav's destination rows, down to the radius step,
                          // the inline padding, and the whole selected treatment (owner call
                          // 2026-08-11: the full-round pills were off the system's scale). The two
                          // columns stand side by side at this width, so anything else reads as a
                          // seam between them.
                          className={cn(
                            'relative flex min-h-[var(--bb-touch-min)] min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-start transition-colors',
                            'hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                            active ? 'bg-accent text-accent-foreground' : 'text-foreground',
                          )}
                        >
                          {/* The blue inline-start marker on the open conversation — the second,
                              non-colour signal beside the accent surface; sits in the rail's inline
                              padding gutter and mirrors with the layout. Decorative. */}
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute top-2 bottom-2 -start-[0.5625rem] w-[3px] rounded-full bg-primary"
                            />
                          )}
                          {/* The open conversation's glyph carries the reserved `fill` weight, the
                              third signal the side-nav row wears. Decorative: the title names it. */}
                          <Icon
                            name="threads"
                            size="sm"
                            active={active}
                            className={cn(
                              'shrink-0',
                              active ? 'text-accent-foreground' : 'text-muted-foreground',
                            )}
                          />
                          <span dir="auto" className="truncate text-sm font-medium">
                            {thread.title}
                          </span>
                        </button>
                        <DropdownMenu
                          label={t('threadActions', { title: thread.title })}
                          trigger={overflowTrigger(
                            t('threadActions', { title: thread.title }),
                            // Where there is a pointer to hover with, the glyph rests hidden and
                            // the rail reads as titles alone; it returns on hover, on keyboard
                            // focus, and while its own menu is open. Below `lg` this list is the
                            // touch Sheet, where nothing hovers — there it always shows.
                            'lg:opacity-0 lg:transition-opacity lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100 lg:aria-expanded:opacity-100',
                          )}
                        >
                          <DropdownMenuItem
                            tone="destructive"
                            onSelect={() => setConfirmingId(thread.id)}
                          >
                            <Icon name="delete" size="sm" />
                            {t('deleteThread')}
                          </DropdownMenuItem>
                        </DropdownMenu>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </nav>

      <AlertDialog
        open={confirmingId !== null}
        title={t('confirmDeleteThread')}
        confirmLabel={t('deleteThread')}
        cancelLabel={tCommon('cancel')}
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setConfirmingId(null)}
        onConfirm={() => {
          if (confirmingId !== null) {
            deleteMutation.mutate(confirmingId)
          }
        }}
      />
    </div>
  )
}
