import { useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { assistantApi } from '../../lib/api.js'
import { Composer } from './composer.js'
import { MessageList, type Phase, type Turn } from './message-list.js'
import { useStickToBottom } from './use-stick-to-bottom.js'

// The Assistant conversation surface (#93): a staff member asks a question and reads a formatted,
// procedure-grounded answer, one-handed on a phone, in Hebrew or English. It leads with the
// conversation — the composer sends, the question appears, then the agent's Markdown reply reveals
// with a cosmetic typewriter (ADR-0003, no real streaming). A single active thread is enough here;
// the thread drawer, list, switching, and example chips are the next ticket.
//
// The surface renders from its own local view rather than mirroring the server's message list. That
// is what the ADR-0003 answer shape asks of the client: creating a thread writes the first user turn
// and the answer path writes another user turn plus the reply, so a naive mirror would echo the first
// question twice. Holding the view locally also gives the three behaviours the ticket needs — an
// optimistic echo of the question, a typewriter over the newest reply, and an inline retry that keeps
// the question and adds no error turn when the one synchronous call fails.
export function AssistantScreen() {
  const t = useTranslations('assistant')

  const [turns, setTurns] = useState<Turn[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  // The thread is created lazily on the first question and reused for the session. Held in a ref, not
  // state, because nothing renders from it and reading it must not lag a re-render mid-exchange.
  const threadIdRef = useRef<string | null>(null)
  // The question awaiting a successful answer, kept so the inline retry can re-ask it verbatim.
  const pendingRef = useRef<string | null>(null)
  // The newest agent turn — the only one that plays the reveal; older replies render in full.
  const [animatingId, setAnimatingId] = useState<string | null>(null)
  // The latest completed answer, announced once to assistive tech (the bubbles stay non-live so the
  // reveal's rapid text mutation is not read out character by character).
  const [announcement, setAnnouncement] = useState('')

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
        // view is correct (the question is echoed once, the trailing agent turn is the answer), but a
        // thread reopened from history (the next ticket) would show the doubled opening turn until the
        // backend grows a create-and-answer path or the reload de-dupes. Frontend-only, this pairing
        // is the least-bad option: create needs non-empty content, and only the answer path answers.
        const created = await assistantApi.createThread({ content: question })
        threadIdRef.current = created.id
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

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>

      <MessageList
        turns={turns}
        phase={phase}
        animatingId={animatingId}
        onRetry={onRetry}
        endRef={endRef}
      />

      {/* The one polite live region: the completed answer, announced once (the reveal itself is
          silent to avoid a character-by-character read-out). */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <Composer onSend={(question) => void ask(question, true)} disabled={phase === 'sending'} />
    </section>
  )
}
