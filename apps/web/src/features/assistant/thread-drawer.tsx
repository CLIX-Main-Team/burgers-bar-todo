import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { assistantApi } from '../../lib/api.js'
import { cn } from '../../lib/cn.js'

// The one cache key the drawer reads and the screen invalidates: starting a new thread (#94) marks
// this stale so the next open shows it in the list. React Query dedupes and caches by this key, so a
// reopen paints the last-known list instantly, then refetches.
export const THREADS_QUERY_KEY = ['threads'] as const

// The thread drawer (#94): a staff member's own conversations, tucked behind a drawer so switching is
// there without crowding the conversation. It is the design system's ThreadList, opened as a Sheet
// (components.md §Sheet/§ThreadList): a panel that rises from the bottom over a scrim so its content
// sits in the thumb zone (principle 1), closing on the scrim, the close button, or Escape. A new
// -conversation primary action sits at the top so starting fresh and switching are one surface; each
// thread is a full-width row recognisable by its server-derived title, the active one carrying the
// selected accent surface so a reader knows which conversation they are in. Direction-aware by logical
// properties (text-start, inset-x-0) — the bottom-anchored sheet is symmetric, its rows flip with `dir`.
//
// The list is read only while the drawer is open (this component mounts with it), author-scoped by the
// API from the principal (ADR-0007) — the SPA never asks for a scope. Titles are the only thread text
// the drawer shows; a question and an answer are user/model content read inside the conversation, not
// here.
export function ThreadDrawer({
  onClose,
  activeThreadId,
  onSelect,
  onNewThread,
}: {
  onClose(): void
  activeThreadId: string | null
  onSelect(id: string): void
  onNewThread(): void
}) {
  const t = useTranslations('assistant')
  const titleId = useId()
  const panelRef = useRef<HTMLDialogElement>(null)

  const query = useQuery({ queryKey: THREADS_QUERY_KEY, queryFn: assistantApi.listThreads })

  // Close on Escape, the lightweight-overlay convention the account menu also honours; move focus into
  // the panel on open so keyboard and screen-reader users land inside the dialog, not behind it.
  useEffect(() => {
    panelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30">
      {/* The scrim: dims the conversation and closes the drawer on a tap outside the panel. */}
      <button
        type="button"
        aria-label={t('closeThreads')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* A native <dialog> for its implicit dialog role, but held open declaratively rather than via
          showModal(): showModal()'s top layer and ::backdrop would fight this custom scrim and the
          bottom-anchored positioning, so it renders in normal flow, positioned and reset (m-0 border-0
          p-0) over the UA styles. aria-modal tells assistive tech the rest of the app is inert behind
          it. Bottom-anchored and capped at 85vh so the conversation peeks above, keeping the sheet's
          actions in the thumb zone; rounded at the anchored (top) edge as sheets are. */}
      <dialog
        ref={panelRef}
        open
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 m-0 flex max-h-[85vh] w-full flex-col rounded-t-2xl border-0 bg-card p-0 text-card-foreground shadow-xl outline-none pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {t('threads')}
          </h2>
          <Button variant="ghost" size="icon" aria-label={t('closeThreads')} onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>

        <div className="p-4">
          {/* The sheet's primary action (components.md §ThreadList): the single gold action here. */}
          <Button className="w-full justify-start gap-2" onClick={onNewThread}>
            {/* Leading glyph is decorative — the button text names the action. */}
            <Icon name="new-thread" />
            {t('newThread')}
          </Button>
        </div>

        {/* The list scrolls independently so a long history never pushes the new-conversation action
            off a short phone screen. */}
        <nav
          aria-label={t('threadsListLabel')}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        >
          {query.isPending ? (
            // Skeleton rows shaped like the real thread rows while the list loads (components.md
            // §ThreadList / §Skeleton); the label rides sr-only so assistive tech still hears it.
            <>
              <span className="sr-only">{t('threadsLoading')}</span>
              <ul aria-hidden="true" className="flex flex-col gap-1">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex min-h-[44px] items-center gap-2 px-2">
                    <span className="size-4 shrink-0 animate-pulse rounded-full bg-muted" />
                    <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
                  </li>
                ))}
              </ul>
            </>
          ) : query.isError ? (
            <Alert tone="error" className="mx-2">
              {t('threadsLoadFailed')}
            </Alert>
          ) : query.data.threads.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">{t('threadsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {query.data.threads.map((thread) => {
                const active = thread.id === activeThreadId
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      // aria-current marks the conversation the reader is in — the drawer's one bit of
                      // selection state, and what assistive tech reads out on the active row.
                      aria-current={active ? 'true' : undefined}
                      onClick={() => onSelect(thread.id)}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-start text-sm text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                        active && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <Icon name="threads" size="sm" className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{thread.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </nav>
      </dialog>
    </div>
  )
}
