import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { AlertDialog } from '../../components/ui/alert-dialog.js'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { DropdownMenu, DropdownMenuItem } from '../../components/ui/dropdown-menu.js'
import { Icon } from '../../components/ui/icon.js'
import { Sheet } from '../../components/ui/sheet.js'
import { assistantApi } from '../../lib/api.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { overflowTrigger } from '../tasks/task-menu.js'
import { Composer } from './composer.js'
import { ExampleChips } from './example-chips.js'
import { AssistantMark, MessageList, type Phase, type Turn } from './message-list.js'
import { turnsFromMessages } from './thread-history.js'
import { THREADS_QUERY_KEY, ThreadList } from './thread-list.js'
import { useStickToBottom } from './use-stick-to-bottom.js'

// Where the last-open conversation's id lives between visits (same browser-storage home as
// the session token). Read once on mount to reopen it; cleared when the user starts a
// clean new chat, so the tab comes back to whatever state it was left in.
const LAST_THREAD_KEY = 'burgers.assistant.lastThread'

// The Assistant surface (#93, #94, threads #228), recut to The Counter (round 8,
// 2026-08-14): on desktop the whole surface is ONE contained card — the thread rail inside
// its inline-start edge over a soft wash, and the conversation pane beside it opening with
// a header that names the thread and what the assistant answers from ("Answers come from
// the knowledge base and cite their source"), with the composer pinned under a hairline at
// its foot. The full-bleed rail-against-the-side-nav layout is retired with this recut; the
// screen sits in the shell's ordinary content frame again. Below `lg` the phone/tablet
// layout keeps its shape, with the thread history and New chat as bordered, transparent
// icon buttons (owner call, rev 3 — the familiar icon, made obviously tappable).
//
// It leads with the conversation — the composer sends, the question appears, then the
// agent's Markdown reply reveals with a cosmetic typewriter (ADR-0003, no real streaming).
// On an empty thread, example-question chips populate the composer so someone new knows
// what they can ask.
//
// The surface renders from its own local view rather than mirroring the server's message
// list (see thread-history.ts for why); each local turn is stamped with its moment so the
// conversation's day chips group a reopened history correctly.
export function AssistantScreen() {
  const t = useTranslations('assistant')
  const tCommon = useTranslations('common')
  const queryClient = useQueryClient()

  // The thread list is a rail from `lg` and a Sheet below it. Gated in JS, not CSS, so the rail's
  // `GET /threads` read fires only where the rail shows — a phone stays lazy until the Sheet opens.
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  // The active thread. Held both in a ref and in state: the ref is the source of truth for the ask
  // flow, which reads and writes it within one async call and must not lag a re-render mid-exchange;
  // the state drives what renders from it (the rail's active mark, the chat header's title).
  const threadIdRef = useRef<string | null>(null)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  // The question awaiting a successful answer, kept so the inline retry can re-ask it verbatim.
  const pendingRef = useRef<string | null>(null)
  // The newest agent turn — the only one that plays the reveal; older replies (and a reopened
  // thread's whole history) render in full.
  const [animatingId, setAnimatingId] = useState<string | null>(null)
  // The latest completed answer, announced once to assistive tech (the bubbles stay non-live so the
  // reveal's rapid text mutation is not read out character by character).
  const [announcement, setAnnouncement] = useState('')

  // The composer text, lifted here so an example chip can populate it and a send can clear it.
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The conversation open when the tab was last left, read once before the persist effect
  // below can touch the store. Null on a first visit or after an explicit new chat.
  const [savedThreadId] = useState(() => localStorage.getItem(LAST_THREAD_KEY))

  // The thread Sheet's open state (below `lg` only), and the two transient states of loading one
  // thread's history. `opening` starts true when a restore is coming, so the empty-state
  // chips never flash before the reopened history lands.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [opening, setOpening] = useState(savedThreadId !== null)
  const [openFailed, setOpenFailed] = useState(false)

  // The chat header confirms deleting the open conversation through the same
  // menu-then-AlertDialog shape the rail's rows use.
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const localIdRef = useRef(0)
  const nextLocalId = () => `local-${localIdRef.current++}`

  const { scrollRef, endRef, jumpToBottom } = useStickToBottom(`${turns.length}:${phase}`)

  // The chat header names the open conversation. The titles live in the same list read the
  // rail holds (React Query dedupes to one request); a fresh, not-yet-created thread reads
  // as the screen's own name.
  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: assistantApi.listThreads,
    enabled: isDesktop,
  })
  const chatTitle =
    (activeThreadId
      ? threadsQuery.data?.threads.find((thread) => thread.id === activeThreadId)?.title
      : null) ?? t('title')

  // Ask a question and reveal the grounded answer. `echo` is true for a fresh question (append the
  // user bubble) and false for a retry (the bubble is already there). On the first question this also
  // creates the thread; a failed call leaves the question in place and surfaces the inline retry with
  // nothing persisted (ADR-0003).
  const ask = async (question: string, echo: boolean) => {
    if (echo) {
      setTurns((prev) => [
        ...prev,
        {
          id: nextLocalId(),
          role: 'user',
          content: question,
          createdAt: new Date().toISOString(),
        },
      ])
    }
    // Asking re-pins the conversation even from halfway up an old answer: the sender should see
    // their question and the reply arrive, not stay marooned in history.
    jumpToBottom()
    pendingRef.current = question
    setPhase('sending')

    try {
      if (threadIdRef.current === null) {
        // First question: create the thread, then answer it (see thread-history.ts for the
        // doubled-opening wrinkle this leaves in the persisted thread). The new thread is
        // stamped active and the list invalidated so it appears in the rail.
        const created = await assistantApi.createThread({ content: question })
        threadIdRef.current = created.id
        setActiveThreadId(created.id)
        void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
      }
      const detail = await assistantApi.postMessage(threadIdRef.current, { content: question })
      // The reply is the exchange's final agent turn; scan from the end so a longer history is safe.
      const answer = [...detail.messages].reverse().find((m) => m.role === 'agent')
      if (!answer) {
        throw new Error('answer response carried no agent turn')
      }
      setTurns((prev) => [
        ...prev,
        // Carry the answer's grounding docs (#227) so the attribution chips render beneath a
        // doc-grounded reply; a task-grounded answer or a refusal arrives with an empty/absent list.
        {
          id: answer.id,
          role: 'agent',
          content: answer.content,
          createdAt: answer.createdAt,
          sources: answer.sources,
        },
      ])
      setAnimatingId(answer.id)
      setAnnouncement(answer.content)
      pendingRef.current = null
      setPhase('idle')
    } catch {
      // A transient failure (a 503 model hiccup or a dropped request): keep the question, show the
      // inline retry. Nothing was persisted, so retry re-asks in place with no orphaned turn.
      setPhase('error')
    }
  }

  const onRetry = () => {
    const question = pendingRef.current
    if (question !== null) {
      void ask(question, false)
    }
  }

  // Switch the conversation to an earlier thread's history (#94). The Sheet closes, the history loads
  // scoped to the caller (ADR-0007), and the local view is rebuilt from it — no reveal, since a
  // reopened answer is already read. A failed load leaves the current conversation untouched under a
  // soft notice rather than clearing it — except on the silent mount-time restore, where a stale
  // id just means starting clean.
  const openThread = async (id: string, silent = false) => {
    setSheetOpen(false)
    setOpenFailed(false)
    setOpening(true)
    try {
      const detail = await assistantApi.getThread(id)
      threadIdRef.current = detail.id
      setActiveThreadId(detail.id)
      setTurns(turnsFromMessages(detail.messages))
      // A reopened conversation lands on its newest turn, exactly where it was left off — not
      // scrolled to its oldest message.
      jumpToBottom()
      setAnimatingId(null)
      setAnnouncement('')
      pendingRef.current = null
      setPhase('idle')
    } catch {
      if (!silent) {
        setOpenFailed(true)
      }
    } finally {
      setOpening(false)
    }
  }

  // Reopen the conversation that was open when the tab was last left (owner ask 2026-08-16):
  // a visit used to always start clean, so a regular's repeated question piled up as
  // near-duplicate threads. A stale saved id — the thread since deleted, or another
  // account's on a shared device (the API scopes the read, ADR-0007) — fails silently into
  // the clean first-run state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the restore runs exactly once, on mount.
  useEffect(() => {
    if (savedThreadId !== null) {
      void openThread(savedThreadId, true)
    }
  }, [])

  // Remember the open conversation for the next visit; a clean new chat clears it, so the
  // tab reopens to whichever of the two states it was left in.
  useEffect(() => {
    if (activeThreadId !== null) {
      localStorage.setItem(LAST_THREAD_KEY, activeThreadId)
    } else {
      localStorage.removeItem(LAST_THREAD_KEY)
    }
  }, [activeThreadId])

  // A conversation the user deleted from the rail (#257): when it was the open one, the view resets
  // to the empty first-run state — its history is gone, so there is nothing left to show.
  const onThreadDeleted = (id: string) => {
    if (id === threadIdRef.current) {
      startNewThread()
    }
  }

  // The chat header's own delete (The Counter): the same hard delete the rail offers, for the
  // conversation currently open.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => assistantApi.deleteThread(id),
    onSuccess: (_data, id) => {
      setConfirmingDelete(false)
      void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
      onThreadDeleted(id)
    },
  })

  // Start a fresh conversation (#94): drop back to the empty thread so a new topic does not tangle
  // with an old one. The next question creates a new thread lazily, exactly as the first ever did.
  const startNewThread = () => {
    setSheetOpen(false)
    threadIdRef.current = null
    setActiveThreadId(null)
    setTurns([])
    setPhase('idle')
    setAnimatingId(null)
    setAnnouncement('')
    setOpenFailed(false)
    pendingRef.current = null
    setDraft('')
  }

  // Tapping an example chip fills the composer and focuses it — the question is offered, not sent, so
  // it is ready to edit or send.
  const pickExample = (question: string) => {
    setDraft(question)
    inputRef.current?.focus()
  }

  const isEmpty = !opening && turns.length === 0 && phase === 'idle'

  // The conversation contents, shared by both layouts (only one mounts at a time): the loading
  // line or the turns, the empty-state chips, and the one polite live region.
  const messages: ReactNode = (
    <>
      {opening ? (
        <p className="text-sm text-muted-foreground">{tCommon('working')}</p>
      ) : (
        <>
          {openFailed ? <Alert tone="error">{t('threadsLoadFailed')}</Alert> : null}

          <MessageList
            turns={turns}
            phase={phase}
            animatingId={animatingId}
            onRetry={onRetry}
            endRef={endRef}
          />

          {isEmpty ? <ExampleChips onPick={pickExample} /> : null}
        </>
      )}

      {/* The one polite live region: the completed answer, announced once (the reveal itself is
          silent to avoid a character-by-character read-out). */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  )

  const composer = (
    <Composer
      value={draft}
      onChange={setDraft}
      onSend={(question) => {
        setDraft('')
        void ask(question, true)
      }}
      disabled={phase === 'sending' || opening}
      sending={phase === 'sending'}
      inputRef={inputRef}
    />
  )

  // The screen fills the shell's content region instead of flowing: `data-fills-shell` asks the
  // shell to hard-bound its column to the region's height (app-layout), and the flex-1/min-h-0
  // chain below hands that bound down to the chat pane — the pane scrolls, the shell's main
  // region does not.
  return (
    <section
      data-fills-shell
      className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-4 md:max-w-[52rem] lg:max-w-none"
    >
      {isDesktop ? (
        // `≥ lg`: The Counter's contained surface — one bordered card holding the thread
        // rail and the conversation side by side. The page keeps an sr-only h1 (the chat
        // header's thread title is the visible lead).
        <>
          <h1 className="sr-only">{t('title')}</h1>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {/* The rail: a soft wash behind two-line rows, divided from the chat by a
                hairline. Its rows scroll inside it (ThreadList owns that). */}
            <aside
              aria-label={t('threads')}
              className="flex min-h-0 w-[250px] flex-none flex-col border-e border-border bg-muted/40 px-2.5 py-3.5"
            >
              <ThreadList
                activeThreadId={activeThreadId}
                onSelect={(id) => void openThread(id)}
                onNewThread={startNewThread}
                onDeleted={onThreadDeleted}
              />
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* The chat header: the (B) mark, the open thread's title over what the
                  assistant answers from, and the conversation's own menu. */}
              <div className="flex flex-none items-center gap-[11px] border-b border-border px-4.5 py-[11px]">
                <AssistantMark />
                <div className="min-w-0">
                  <p className="truncate text-body font-bold text-foreground" dir="auto">
                    {chatTitle}
                  </p>
                  <p className="truncate text-caption text-muted-foreground">
                    {t('groundingNote')}
                  </p>
                </div>
                {activeThreadId ? (
                  <div className="ms-auto">
                    <DropdownMenu
                      label={t('threadActions', { title: chatTitle })}
                      trigger={overflowTrigger(t('threadActions', { title: chatTitle }))}
                    >
                      <DropdownMenuItem
                        tone="destructive"
                        onSelect={() => setConfirmingDelete(true)}
                      >
                        <Icon name="delete" size="sm" />
                        {t('deleteThread')}
                      </DropdownMenuItem>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>

              {/* The messages pane — the surface's one scroll region, its text capped at a
                  book measure and centred. */}
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-4">{messages}</div>
              </div>

              {/* The composer, pinned under its hairline at the card's foot. */}
              <div className="flex-none border-t border-border px-4.5 py-3.5">
                <div className="mx-auto w-full max-w-[46rem]">{composer}</div>
              </div>
            </div>
          </div>
        </>
      ) : (
        // `< lg`: a single column, no rail. The thread list opens as the Sheet from the
        // bordered, transparent icon buttons beside the title — the history's familiar
        // glyph made obviously tappable, and New chat beside it (owner call, rev 3).
        <>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-heading-lg font-extrabold text-foreground">{t('title')}</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={t('openThreads')}
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                className="rounded-md border-border-strong bg-transparent text-muted-foreground"
                onClick={() => setSheetOpen(true)}
              >
                <Icon name="threads" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('newThread')}
                className="rounded-md border-border-strong bg-transparent text-muted-foreground"
                onClick={startNewThread}
              >
                <Icon name="create" />
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-4">{messages}</div>
            </div>
            {composer}
          </div>

          <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('threads')}>
            <ThreadList
              activeThreadId={activeThreadId}
              onSelect={(id) => void openThread(id)}
              onNewThread={startNewThread}
              onDeleted={onThreadDeleted}
            />
          </Sheet>
        </>
      )}

      <AlertDialog
        open={confirmingDelete}
        title={t('confirmDeleteThread')}
        confirmLabel={t('deleteThread')}
        cancelLabel={tCommon('cancel')}
        confirmDisabled={deleteMutation.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          if (threadIdRef.current !== null) {
            deleteMutation.mutate(threadIdRef.current)
          }
        }}
      />
    </section>
  )
}
