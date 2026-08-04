import type { RefObject } from 'react'
import { useTranslations } from 'use-intl'
import { Alert } from '../../components/ui/alert.js'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { cn } from '../../lib/cn.js'
import { Markdown } from './markdown.js'
import { useTypewriter } from './use-typewriter.js'

// A single conversation turn as the surface holds it locally (#93). `id` is a client id for the
// user's echoed question and the server message id for an agent reply; `role` decides the bubble's
// side and whether the body is rendered as Markdown. The text is never catalogued — a question and a
// reply are user/model content, shown verbatim in whatever language they were written.
export interface Turn {
  id: string
  role: 'user' | 'agent'
  content: string
}

// The overall state of the one in-flight exchange, which drives the trailing indicator: `idle`
// shows nothing, `sending` shows the thinking bubble, `error` shows the inline retry.
export type Phase = 'idle' | 'sending' | 'error'

// The user's question: a solid gold bubble on the trailing (end) side. Plain text only, wrapped so a
// multi-line question keeps its line breaks; never Markdown, since it is the staff member's own words.
function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-ee-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
        {content}
      </div>
    </div>
  )
}

// The assistant's reply: a bordered card bubble on the leading (start) side, its Markdown body
// revealed by the typewriter while this is the newest turn (`animate`). Labelled for assistive tech.
function AgentBubble({ content, animate }: { content: string; animate: boolean }) {
  const t = useTranslations('assistant')
  const visible = useTypewriter(content, animate)
  return (
    <div className="flex justify-start">
      <div
        aria-label={t('answerLabel')}
        className="max-w-[90%] space-y-2 rounded-lg rounded-es-sm border border-border bg-card px-3 py-2 text-sm leading-relaxed text-card-foreground"
      >
        <Markdown text={visible} />
      </div>
    </div>
  )
}

// The transient "answering" indicator (ADR-0003: one synchronous call). A leading-side bubble with
// three pulsing dots; the label is announced by the screen's live region, so the dots are decorative.
function ThinkingBubble() {
  const t = useTranslations('assistant')
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-lg rounded-es-sm border border-border bg-card px-3 py-3 text-card-foreground">
        <span className="sr-only">{t('thinking')}</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// A failed answer, shown inline where the reply would have gone (#93, ADR-0003): the question bubble
// above it is untouched, and no error turn is added to the thread — retry re-asks the same preserved
// question in place. The notice reads through the soft error tone; the retry carries the retry glyph.
function RetryNotice({ onRetry }: { onRetry(): void }) {
  const t = useTranslations('assistant')
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[90%] flex-col items-start gap-2">
        <Alert tone="error">{t('failed')}</Alert>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <Icon name="retry" size="sm" className="me-2" />
          {t('retry')}
        </Button>
      </div>
    </div>
  )
}

// The conversation body: the turns in order, then the trailing indicator for the current phase, then
// the sentinel the stick-to-bottom hook scrolls into view. `animatingId` names the single agent turn
// that should play its reveal (the newest); every other renders in full at once.
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
  const isEmpty = turns.length === 0 && phase === 'idle'

  return (
    <div className={cn('flex flex-col gap-3')} aria-label={t('conversationLabel')}>
      {isEmpty ? <p className="text-sm text-muted-foreground">{t('empty')}</p> : null}

      {turns.map((turn) =>
        turn.role === 'user' ? (
          <UserBubble key={turn.id} content={turn.content} />
        ) : (
          <AgentBubble key={turn.id} content={turn.content} animate={turn.id === animatingId} />
        ),
      )}

      {phase === 'sending' ? <ThinkingBubble /> : null}
      {phase === 'error' ? <RetryNotice onRetry={onRetry} /> : null}

      <div ref={endRef} />
    </div>
  )
}
