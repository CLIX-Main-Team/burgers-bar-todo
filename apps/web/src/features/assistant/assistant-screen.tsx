import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { Sheet } from '../../components/ui/sheet.js'
import { assistantApi } from '../../lib/api.js'
import { useMediaQuery } from '../../lib/use-media-query.js'
import { Composer } from './composer.js'
import { ExampleChips } from './example-chips.js'
import { MessageList, type Phase, type Turn } from './message-list.js'
import { turnsFromMessages } from './thread-history.js'
import { THREADS_QUERY_KEY, ThreadList } from './thread-list.js'
import { useStickToBottom } from './use-stick-to-bottom.js'

// The Assistant surface (#93, #94, redesigned #226, threads graduated #228): a staff member asks a
// question and reads a formatted, procedure-grounded answer, one-handed on a phone, in Hebrew or
// English — and keeps several conversations, finding an earlier one, starting a new one, and switching
// between them. It leads with the conversation — the composer sends, the question appears, then the
// agent's Markdown reply reveals with a cosmetic typewriter (ADR-0003, no real streaming). On an empty
// thread, example-question chips populate the composer so someone new knows what they can ask.
//
// The thread list graduates with width (#228, mockup #178): from `lg` it is a persistent `muted` rail
// inside the content frame beside a book-measure conversation; below `lg` it is the DS Sheet, reached
// from a threads icon-button on mobile and a Conversations button at `md`. The rail (and its list read)
// mounts only at the width that shows it — a phone never fetches the list until the Sheet is opened.
//
// The surface renders from its own local view rather than mirroring the server's message list. That
// is what the ADR-0003 answer shape asks of the client: creating a thread writes the first user turn
// and the answer path writes another user turn plus the reply, so a naive mirror would echo the first
// question twice. Holding the view locally also gives the behaviours the tickets need — an optimistic
// echo of the question, a typewriter over the newest reply, and an inline retry that keeps the
// question and adds no error turn when the one synchronous call fails. A thread reopened from the list
// is mapped through turnsFromMessages, which collapses that persisted doubled opening turn so a
// switched-to conversation reads the way the live one did.
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
  // the state drives what renders from it (the list's active-conversation mark). They are set
  // together — on a switch, a new thread, and the lazy create.
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

  // The thread Sheet's open state (below `lg` only), and the two transient states of loading one
  // thread's history: `opening` shows a loading line, `openFailed` a soft notice that leaves the
  // current conversation in place rather than clearing it to an error.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const localIdRef = useRef(0)
  const nextLocalId = () => `local-${localIdRef.current++}`

  const { scrollRef, endRef, jumpToBottom } = useStickToBottom(`${turns.length}:${phase}`)

  // Ask a question and reveal the grounded answer. `echo` is true for a fresh question (append the
  // user bubble) and false for a retry (the bubble is already there). On the first question this also
  // creates the thread; a failed call leaves the question in place and surfaces the inline retry with
  // nothing persisted (ADR-0003).
  const ask = async (question: string, echo: boolean) => {
    if (echo) {
      setTurns((prev) => [...prev, { id: nextLocalId(), role: 'user', content: question }])
    }
    // Asking re-pins the conversation even from halfway up an old answer: the sender should see
    // their question and the reply arrive, not stay marooned in history.
    jumpToBottom()
    pendingRef.current = question
    setPhase('sending')

    try {
      if (threadIdRef.current === null) {
        // First question: create the thread, then answer it. The two endpoints do not compose
        // cleanly — create writes a user turn but no answer, and the answer path writes another user
        // turn plus the reply — so the persisted thread carries the opening question twice. The live
        // view is correct (the question is echoed once, the trailing agent turn is the answer), and a
        // thread reopened from the list collapses the doubled opening turn (turnsFromMessages). The
        // new thread is stamped active and the list invalidated so it appears there.
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
        { id: answer.id, role: 'agent', content: answer.content, sources: answer.sources },
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
  // soft notice rather than clearing it.
  const openThread = async (id: string) => {
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
      setOpenFailed(true)
    } finally {
      setOpening(false)
    }
  }

  // A conversation the user deleted from the list (#257): when it was the open one, the view resets
  // to the empty first-run state — its history is gone, so there is nothing left to show. Deleting a
  // background conversation touches nothing here; the list has already refetched without it.
  const onThreadDeleted = (id: string) => {
    if (id === threadIdRef.current) {
      startNewThread()
    }
  }

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

  // The conversation column, shared by both layouts — two stacked containers in the LLM-chat shape
  // (owner ask 2026-08, matching what components.md §Composer always specified): the messages in
  // their own scrolling pane, and the Composer in a separate block below it that never moves. The
  // pane takes the column's spare height (flex-1 min-h-0, bounded by the viewport-pinned shell), so
  // a growing thread scrolls inside it while the composer stays put. The reading content caps its
  // text measure at a book width (~42rem) and centres so a wide desktop frame never stretches the
  // thread edge to edge (shell decision 3); the Composer spans the column, wider than the reading
  // measure, exactly as the mockup draws it (the book measure governs the thread text, not the
  // control). Below the cap (mobile) both simply fill the column.
  const conversation: ReactNode = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-4">
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
        </div>
      </div>

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
    </div>
  )

  // The screen caps at the shell's mobile width, widens to a single ~52rem reading column at `md`, and
  // from `lg` takes the whole content region. It draws no chrome and no Create FAB — the Composer owns
  // the bottom region (components.md). Unlike every other screen it fills the shell's content region
  // instead of flowing: `data-fills-shell` asks the shell to hard-bound its column to the region's
  // height (app-layout), and the flex-1/min-h-0 chain below hands that bound down to the chat pane —
  // the pane scrolls, the shell's main region does not. From `lg` it also stamps `data-bleeds-shell`:
  // the frame's cap, centring, and padding come off so the thread rail sits flush against the side
  // nav instead of floating mid-frame (owner ask 2026-08-10, superseding the rail-in-frame call in
  // mockups/assistant/spec.md).
  return (
    <section
      data-fills-shell
      data-bleeds-shell
      className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-4 md:max-w-[52rem] lg:max-w-none lg:gap-0"
    >
      {isDesktop ? (
        // `≥ lg`: the full-bleed two-column grid — a ~240px thread rail pinned to the inline-start
        // edge, directly beside the shell's side nav (same width token, so the two read as one
        // chrome stack), and the conversation in the remaining space. No Sheet and no header
        // trigger: the rail is the thread affordance. Both columns stretch the region's full
        // height: the rail is a full-height sidebar (its rows scroll inside it), the conversation
        // column hosts the chat pane + pinned composer and centres its own ~52rem measure since
        // the frame no longer centres for it. The single row is minmax(0,1fr), not auto: an auto
        // row would size to the taller column's content and overflow the bounded grid, un-bounding
        // both columns' inner scrollers.
        <div className="grid min-h-0 flex-1 grid-cols-[var(--bb-sidenav)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
          <aside
            aria-label={t('threads')}
            className="flex min-h-0 flex-col border-e border-border bg-muted p-3"
          >
            <ThreadList
              activeThreadId={activeThreadId}
              onSelect={(id) => void openThread(id)}
              onNewThread={startNewThread}
              onDeleted={onThreadDeleted}
            />
          </aside>

          <div className="flex min-h-0 min-w-0 flex-col px-6 pt-8 pb-12">
            <div className="mx-auto flex min-h-0 w-full max-w-[52rem] flex-1 flex-col">
              {/* The compact title heading the conversation column — the rail owns New conversation,
                  so this is title-only at this width. */}
              <h1 className="mx-auto w-full max-w-[42rem] pb-2 text-lg font-semibold text-foreground">
                {t('title')}
              </h1>
              {conversation}
            </div>
          </div>
        </div>
      ) : (
        // `< lg`: a single column, no rail. The thread list opens as the Sheet from a width-gated
        // trigger — a threads icon-button on mobile, a Conversations Button at `md`.
        <>
          {/* Mobile (`< md`) in-content header: threads icon-button + title. */}
          <div className="flex items-center gap-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('openThreads')}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
            >
              <Icon name="threads" />
            </Button>
            <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
          </div>

          {/* `md` content-header: title + a Conversations Button that opens the Sheet (no rail yet —
              the shell keeps content single-column until `lg`, shell decision 4). */}
          <div className="hidden items-center justify-between gap-4 md:flex">
            <h1 className="text-heading-lg font-semibold text-foreground">{t('title')}</h1>
            <Button
              variant="outline"
              size="sm"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
            >
              <Icon name="threads" size="sm" />
              {t('threads')}
            </Button>
          </div>

          {conversation}

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
    </section>
  )
}
