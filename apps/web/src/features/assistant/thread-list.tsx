import type { ThreadSummary } from '@burgers/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { useLocale } from '../../i18n/locale.js'
import { assistantApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'
import { overflowTrigger } from '../tasks/task-menu.js'

// The one cache key the thread list reads and the screen invalidates: starting a new thread (#94)
// marks this stale so the next read shows it. React Query dedupes and caches by this key, so the two
// places this list appears — the desktop rail and the mobile/tablet Sheet — share one read, and a
// reopen paints the last-known list instantly then refetches.
export const THREADS_QUERY_KEY = ['threads'] as const

// Rows are grouped under two small overlines — TODAY and EARLIER (The Counter, round 8,
// tightening the four buckets) — and each row carries two lines: the title, then when the
// conversation was last touched, so "the one from this morning" reads at a glance without a
// calendar on every row.
const BUCKETS = ['today', 'earlier'] as const
type Bucket = (typeof BUCKETS)[number]

const BUCKET_LABEL: Record<Bucket, string> = {
  today: 'threadsToday',
  earlier: 'threadsEarlier',
}

// Days from local midnight, so "today" means the calendar day — not "the last 24 hours" —
// and a DST boundary's odd hour rounds away.
function daysAgo(iso: string, now: Date): number {
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((midnight(now) - midnight(new Date(iso))) / 86_400_000)
}

function bucketFor(iso: string, now: Date): Bucket {
  return daysAgo(iso, now) <= 0 ? 'today' : 'earlier'
}

// The row's second line: the clock time today, the weekday within the week, the date beyond.
function rowTime(iso: string, now: Date, locale: string): string {
  const days = daysAgo(iso, now)
  const date = new Date(iso)
  if (days <= 0) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (days <= 6) {
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
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
  const { locale } = useLocale()
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
      {/* The list's one gold action (The Counter): start fresh, resetting to the first-run
          state; the next question lazily creates the thread. It stands taller than the density
          pass's 34px control (owner call 2026-08-16 — it read cramped for the column's only
          action), which also puts it back on the 44px touch floor for the phone Sheet. */}
      <Button className="h-11 w-full justify-center gap-2" onClick={onNewThread}>
        {/* Leading glyph is decorative — the button text names the action. */}
        <Icon name="create" size="sm" />
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
                  <span className="size-4 shrink-0 rounded-full bg-muted-foreground/20 motion-safe:animate-pulse" />
                  <span className="h-4 flex-1 rounded bg-muted-foreground/20 motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          </>
        ) : query.isError ? (
          <Alert tone="error" className="mx-1">
            {t('threadsLoadFailed')}
          </Alert>
        ) : query.data.threads.length === 0 ? (
          <p className="px-2.5 py-1 text-body text-muted-foreground">{t('threadsEmpty')}</p>
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
                  className="px-3 pt-1.5 pb-1 text-caption font-bold uppercase tracking-wider text-muted-foreground"
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
                      // A button cannot nest inside a button, so the open button and the overflow
                      // menu are siblings — but the menu is laid over the row's inline end rather
                      // than beside it (owner ask 2026-08-16), so the row surface itself runs the
                      // full width of the rail instead of stopping short of the glyph. The button
                      // keeps a matching inline-end padding so a long title never runs under it.
                      <li key={thread.id} className="group/row relative flex items-center">
                        <button
                          type="button"
                          // aria-current marks the conversation the reader is in — the list's one
                          // bit of selection state, and what assistive tech reads on the active row.
                          aria-current={active ? 'true' : undefined}
                          onClick={() => onSelect(thread.id)}
                          // The Counter's two-line row (round 8): the title over its time, no
                          // leading glyph. The open conversation lifts onto the card surface with
                          // the gold marker at its inline-start edge — the rail's quiet ground
                          // makes the raised row the selection signal.
                          className={cn(
                            'relative flex min-h-[var(--bb-touch-min)] min-w-0 flex-1 flex-col items-start justify-center gap-0.5 rounded-md py-2 ps-3 pe-10 text-start transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                            active
                              ? 'bg-card font-semibold text-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
                          )}
                        >
                          {/* The gold inline-start marker on the open conversation — the second,
                              non-colour signal beside the raised surface. Decorative. */}
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute top-2 bottom-2 start-0 w-[3px] rounded-e-full bg-gold"
                            />
                          )}
                          {/* Bidi, the third attempt (2026-08-16). dir="auto" pushed a Hebrew
                              title to the far end of the row, away from the time beneath it;
                              <bdi> fixed that but made an English title in the Hebrew shell
                              truncate from its START ("…ch tasks are open right now?"), because
                              the ellipsis lands at the end of an RTL line box. plaintext gives
                              the title its own paragraph direction — so it renders and truncates
                              from its own end — while text-start keeps it on the shell's reading
                              edge. Both properties are needed; either alone regresses one case. */}
                          <span dir="auto" className="max-w-full truncate text-label font-medium">
                            {thread.title}
                          </span>
                          <span className="max-w-full truncate text-caption text-muted-foreground">
                            {rowTime(thread.updatedAt, now, locale)}
                          </span>
                        </button>
                        <div className="absolute inset-y-0 end-1 flex items-center">
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
                        </div>
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
