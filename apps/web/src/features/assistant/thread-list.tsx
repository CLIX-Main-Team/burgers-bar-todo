import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { useLocale } from '../../i18n/locale.js'
import { assistantApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'

// The one cache key the thread list reads and the screen invalidates: starting a new thread (#94)
// marks this stale so the next read shows it. React Query dedupes and caches by this key, so the two
// places this list appears — the desktop rail and the mobile/tablet Sheet — share one read, and a
// reopen paints the last-known list instantly then refetches.
export const THREADS_QUERY_KEY = ['threads'] as const

// The thread list contents (#94, #228, components.md §ThreadList): the New-conversation action over
// the caller's own auto-titled conversations. It is rendered two ways by the assistant screen — as a
// persistent `muted` rail inside the content frame from `lg`, and as a bottom Sheet below it — but the
// contents are one component so the rows, states, and behaviours never fork between the two.
//
// The list is author-scoped by the API from the principal (ADR-0007) — the SPA never asks for a
// scope, and a response never carries another user's threads. Titles and their timestamps are the
// only thread text shown here; a question and an answer are read inside the conversation, not in the
// list. Every title is `dir="auto"` so a Hebrew conversation title reads correctly inside an English
// rail and the reverse.
export function ThreadList({
  activeThreadId,
  onSelect,
  onNewThread,
}: {
  activeThreadId: string | null
  onSelect(id: string): void
  onNewThread(): void
}) {
  const t = useTranslations('assistant')
  const { locale } = useLocale()
  const query = useQuery({ queryKey: THREADS_QUERY_KEY, queryFn: assistantApi.listThreads })

  // A compact, locale-aware date for each row (the list is most-recently-active first, #90). Kept to
  // month + day so it fits the ~240px rail; the same formatter the task card uses for its dates.
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso))

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* The list's single gold action (components.md §ThreadList): start fresh, resetting to the
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
                `muted` desktop rail as well as the Sheet's `card`, and a `bg-muted` skeleton (the DS
                Skeleton default) would vanish against the rail. The tint contrasts on both. */}
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
          <p className="px-2 py-1 text-sm text-muted-foreground">{t('threadsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {query.data.threads.map((thread) => {
              const active = thread.id === activeThreadId
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    // aria-current marks the conversation the reader is in — the list's one bit of
                    // selection state, and what assistive tech reads out on the active row.
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(thread.id)}
                    className={cn(
                      'relative flex min-h-[var(--bb-touch-min)] w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      active ? 'bg-accent text-accent-foreground' : 'text-foreground',
                    )}
                  >
                    {/* The gold inline-start marker on the active row — the second, non-colour signal
                        beside the accent surface; sits in the tray's inline padding gutter and
                        mirrors with the layout. Decorative. */}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 bottom-1.5 -start-2 w-[3px] rounded-full bg-primary"
                      />
                    )}
                    <Icon
                      name="threads"
                      size="sm"
                      className={cn(
                        'shrink-0',
                        active ? 'text-accent-foreground' : 'text-muted-foreground',
                      )}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span dir="auto" className="truncate text-sm font-medium">
                        {thread.title}
                      </span>
                      <span
                        className={cn(
                          'text-xs',
                          active ? 'text-accent-foreground/80' : 'text-muted-foreground',
                        )}
                      >
                        {formatDate(thread.updatedAt)}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </div>
  )
}
