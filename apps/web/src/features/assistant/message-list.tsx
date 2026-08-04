import type { RefObject } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { Markdown } from './markdown.js'
import { useTypewriter } from './use-typewriter.js'

// A single conversation turn as the surface holds it locally (#93). `id` is a client id for the
// user's echoed question and the server message id for an agent reply; `role` decides the turn's
// side and whether the body is rendered as Markdown. The text is never catalogued — a question and a
// reply are user/model content, shown verbatim in whatever language they were written.
export interface Turn {
  id: string
  role: 'user' | 'agent'
  content: string
}

// The overall state of the one in-flight exchange, which drives the trailing indicator: `idle`
// shows nothing, `sending` shows the pending dots, `error` shows the inline retry.
export type Phase = 'idle' | 'sending' | 'error'

// The pale-accent disc that marks every assistant-side row — the calm document's byline (#226,
// components.md §Assistant). Gold is spent on neither turn, so the mark rests on the accent surface,
// never the primary. Decorative: the row it leads is labelled by its own text.
function AssistantMark() {
  return (
    <span className="mt-0.5 grid size-7 flex-none place-items-center rounded-full bg-accent text-accent-foreground">
      <Icon name="assistant" size="sm" />
    </span>
  )
}

// The user's question: a filled bubble in the secondary surface at the inline-end (#226) — the scarce
// gold is spent only on Send, so this reads quiet, not loud. Plain text, wrapped so a multi-line
// question keeps its breaks; dir="auto" so a Hebrew message inside an English thread keeps its script.
function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        dir="auto"
        className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-ee-sm bg-secondary px-3.5 py-2.5 text-sm leading-relaxed text-secondary-foreground"
      >
        {content}
      </div>
    </div>
  )
}

// The assistant's reply: quiet document-like text on the canvas at the inline-start, no bubble, led by
// the assistant mark (#226). The Markdown body is revealed by the typewriter while this is the newest
// turn (`animate`). Labelled for assistive tech and bidi-isolated so the answer keeps its own script.
function AgentTurn({ content, animate }: { content: string; animate: boolean }) {
  const t = useTranslations('assistant')
  const visible = useTypewriter(content, animate)
  return (
    <div className="flex justify-start gap-2">
      <AssistantMark />
      <div
        aria-label={t('answerLabel')}
        dir="auto"
        className="min-w-0 flex-1 space-y-2 pt-0.5 text-sm leading-relaxed text-foreground"
      >
        <Markdown text={visible} />
      </div>
    </div>
  )
}

// The transient "answering" indicator (ADR-0003: one synchronous call). Three dots on the assistant
// side, led by the mark; role="status" announces "Finding an answer…" once. The pulse is motion-safe,
// so prefers-reduced-motion drops the animation and leaves three resting dots (#226).
function PendingTurn() {
  const t = useTranslations('assistant')
  return (
    <div className="flex justify-start gap-2">
      <AssistantMark />
      {/* <output> carries an implicit role="status" live region — the pending label is announced
          once, and the dots inside are decorative. */}
      <output className="flex h-7 items-center" aria-label={t('thinking')}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="mx-0.5 size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse motion-reduce:opacity-60"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </output>
    </div>
  )
}

// A failed answer, shown inline where the reply would have gone (#93, ADR-0003): the question bubble
// above it is untouched, and no error turn is added to the thread — retry re-asks the same preserved
// question in place. Rendered as one soft destructive-muted notice so it stays visually distinct from
// the grounded refusal, which is ordinary quiet assistant text (#226).
function RetryNotice({ onRetry }: { onRetry(): void }) {
  const t = useTranslations('assistant')
  return (
    <div className="flex justify-start">
      <div
        role="alert"
        className="flex max-w-[85%] flex-wrap items-center gap-3 rounded-lg bg-destructive-muted px-3.5 py-2.5 text-sm text-destructive-muted-foreground"
      >
        <span className="min-w-0">{t('failed')}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="ms-auto border-current bg-transparent text-inherit hover:bg-current/10 hover:text-inherit active:bg-current/15 active:text-inherit"
        >
          <Icon name="retry" size="sm" className="me-2" />
          {t('retry')}
        </Button>
      </div>
    </div>
  )
}

// The conversation body: the turns in order, then the trailing indicator for the current phase, then
// the sentinel the stick-to-bottom hook scrolls into view. `animatingId` names the single agent turn
// that should play its reveal (the newest); every other renders in full at once. The empty first-run
// state is drawn by the screen (ExampleChips), not here.
export function MessageList({
  turns,
  phase,
  animatingId,
  onRetry,
  endRef,
}: {
  turns: Turn[]
  phase: Phase
  animatingId: string | null
  onRetry(): void
  endRef: RefObject<HTMLDivElement | null>
}) {
  const t = useTranslations('assistant')

  return (
    <div className={cn('flex flex-col gap-6')} aria-label={t('conversationLabel')}>
      {turns.map((turn) =>
        turn.role === 'user' ? (
          <UserBubble key={turn.id} content={turn.content} />
        ) : (
          <AgentTurn key={turn.id} content={turn.content} animate={turn.id === animatingId} />
        ),
      )}

      {phase === 'sending' ? <PendingTurn /> : null}
      {phase === 'error' ? <RetryNotice onRetry={onRetry} /> : null}

      <div ref={endRef} />
    </div>
  )
}
