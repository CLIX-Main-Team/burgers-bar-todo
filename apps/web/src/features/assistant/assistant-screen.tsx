import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { assistantApi } from '../../lib/api.js'
import { Composer } from './composer.js'
import { ExampleChips } from './example-chips.js'
import { MessageList, type Phase, type Turn } from './message-list.js'
import { THREADS_QUERY_KEY, ThreadDrawer } from './thread-drawer.js'
import { turnsFromMessages } from './thread-history.js'
import { useStickToBottom } from './use-stick-to-bottom.js'

// The Assistant surface (#93, #94): a staff member asks a question and reads a formatted, procedure-
// grounded answer, one-handed on a phone, in Hebrew or English — and keeps several conversations,
// finding an earlier one, starting a new one, and switching between them through a thread drawer. It
// leads with the conversation — the composer sends, the question appears, then the agent's Markdown
// reply reveals with a cosmetic typewriter (ADR-0003, no real streaming). The thread list is tucked
// behind a drawer so switching is available without crowding the conversation; on an empty thread,
// example-question chips populate the composer so someone new knows what they can ask.
//
// The surface renders from its own local view rather than mirroring the server's message list. That
// is what the ADR-0003 answer shape asks of the client: creating a thread writes the first user turn
// and the answer path writes another user turn plus the reply, so a naive mirror would echo the first
// question twice. Holding the view locally also gives the behaviours the tickets need — an optimistic
// echo of the question, a typewriter over the newest reply, and an inline retry that keeps the
// question and adds no error turn when the one synchronous call fails. A thread reopened from the
// drawer is mapped through turnsFromMessages, which collapses that persisted doubled opening turn so a
// switched-to conversation reads the way the live one did.
export function AssistantScreen() {
  const t = useTranslations('assistant')
  const tCommon = useTranslations('common')
  const queryClient = useQueryClient()

  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  // The active thread. Held both in a ref and in state: the ref is the source of truth for the ask
  // flow, which reads and writes it within one async call and must not lag a re-render mid-exchange;
  // the state drives what renders from it (the drawer's active-conversation mark). They are set
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

  // The thread drawer's open state, and the two transient states of loading one thread's history from
  // the drawer: `opening` shows a loading line, `openFailed` a soft notice that leaves the current
  // conversation in place rather than clearing it to an error.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const localIdRef = useRef(0)
  const nextLocalId = () => `local-${localIdRef.current++}`

  const endRef = useStickToBottom(`${turns.length}:${phase}`)

  // Ask a question and reveal the grounded answer. `echo` is true for a fresh question (append the
  // user bubble) and false for a retry (the bubble is already there). On the first question this also
  // creates the thread; a failed call leaves the question in place and surfaces the inline retry with
  // nothing persisted (ADR-0003).
  const ask = async (question: string, echo: boolean) => {
    if (echo) {
      setTurns((prev) => [...prev, { id: nextLocalId(), role: 'user', content: question }])
    }
    pendingRef.current = question
    setPhase('sending')

    try {
      if (threadIdRef.current === null) {
        // First question: create the thread, then answer it. The two endpoints do not compose
        // cleanly — create writes a user turn but no answer, and the answer path writes another user
        // turn plus the reply — so the persisted thread carries the opening question twice. The live
        // view is correct (the question is echoed once, the trailing agent turn is the answer), and a
        // thread reopened from the drawer collapses the doubled opening turn (turnsFromMessages). The
        // new thread is stamped active and the drawer list invalidated so it appears there.
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
      setTurns((prev) => [...prev, { id: answer.id, role: 'agent', content: answer.content }])
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

  // Switch the conversation to an earlier thread's history (#94). The drawer closes, the history loads
  // scoped to the caller (ADR-0007), and the local view is rebuilt from it — no reveal, since a
  // reopened answer is already read. A failed load leaves the current conversation untouched under a
  // soft notice rather than clearing it.
  const openThread = async (id: string) => {
    setDrawerOpen(false)
    setOpenFailed(false)
    setOpening(true)
    try {
      const detail = await assistantApi.getThread(id)
      threadIdRef.current = detail.id
      setActiveThreadId(detail.id)
      setTurns(turnsFromMessages(detail.messages))
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

  // Start a fresh conversation (#94): drop back to the empty thread so a new topic does not tangle
  // with an old one. The next question creates a new thread lazily, exactly as the first ever did.
  const startNewThread = () => {
    setDrawerOpen(false)
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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('openThreads')}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Icon name="threads" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
      </div>

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

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={(question) => {
          setDraft('')
          void ask(question, true)
        }}
        disabled={phase === 'sending' || opening}
        inputRef={inputRef}
      />

      {drawerOpen ? (
        <ThreadDrawer
          onClose={() => setDrawerOpen(false)}
          activeThreadId={activeThreadId}
          onSelect={(id) => void openThread(id)}
          onNewThread={startNewThread}
        />
      ) : null}
    </section>
  )
}
