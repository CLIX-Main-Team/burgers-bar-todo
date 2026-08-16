import type { MessageSource } from '@burgers/shared'
import type { Ref } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'
import { useLocale } from '../../i18n/locale.js'
import { cn } from '../../lib/cn.js'
import { Markdown } from './markdown.js'
import { useTypewriter } from './use-typewriter.js'

// A single conversation turn as the surface holds it locally (#93). `id` is a client id for the
// user's echoed question and the server message id for an agent reply; `role` decides the turn's
// side and whether the body is rendered as Markdown. `createdAt` (The Counter, round 8) drives
// the day chips a long or reopened conversation groups under; a live echo stamps "now". The text
// is never catalogued — a question and a reply are user/model content, shown verbatim in
// whatever language they were written. `sources` (#227) rides only on an agent reply grounded in
// knowledge docs, so the attribution chips are drawn only where the answer actually cited docs.
export interface Turn {
  id: string
  role: 'user' | 'agent'
  content: string
  createdAt?: string
  sources?: MessageSource[]
}

// The overall state of the one in-flight exchange, which drives the trailing indicator: `idle`
// shows nothing, `sending` shows the pending dots, `error` shows the inline retry.
export type Phase = 'idle' | 'sending' | 'error'

// The bot's mark beside every assistant-side row, recut to The Counter (round 8): the brand's
// (B) held in gold on the board black — the same device the wordmark opens with — replacing
// the raster PWA-icon disc, so it scales and holds in both themes by construction. Decorative:
// the row it leads is labelled by its own text. Exported for the desktop chat header, which
// leads with the same mark.
export function AssistantMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      dir="ltr"
      className={cn(
        'grid size-[30px] flex-none select-none place-items-center rounded-full bg-nav-surface text-[0.6875rem] font-semibold tracking-[0.02em] text-nav-gold',
        className,
      )}
    >
      (B)
    </span>
  )
}

// The user's question, recut to the artifact: a filled bubble on the brand black at the
// inline-end — the sender's words on the menu board — with the small corner toward its edge.
// Plain text, wrapped so a multi-line question keeps its breaks; dir="auto" so a Hebrew
// message inside an English thread keeps its script.
function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        dir="auto"
        className="max-w-[76%] whitespace-pre-wrap rounded-[14px] rounded-se-[4px] bg-nav-surface px-[15px] py-[11px] text-body leading-[1.55] text-nav-ink"
      >
        {content}
      </div>
    </div>
  )
}

// The attribution row beneath a grounded answer (#227), recut to The Counter: the knowledge
// docs the reply drew on as bordered chips in the link blue — Pantone 2727 C spent only on
// sources and links. Each title is bidi-isolated (`dir="auto"`) and truncates so a long title
// never blows the measure. A task-grounded answer or a refusal carries no sources, so the
// caller renders nothing rather than an empty row.
function SourceChips({ sources }: { sources: MessageSource[] }) {
  const t = useTranslations('assistant')
  return (
    <ul aria-label={t('sourcesLabel')} className="flex flex-wrap gap-1.5 pt-1">
      {sources.map((source) => (
        <li key={source.id} className="flex min-w-0">
          <span className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-border-strong px-[9px] py-[2px] text-caption font-semibold text-link">
            <Icon name="knowledge-doc" size="sm" className="flex-none" />
            <span dir="auto" className="min-w-0 truncate">
              {source.title}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// The assistant's reply, recut to the artifact: a quiet bordered bubble on the secondary
// surface at the inline-start, led by the (B) mark, with the small corner toward the mark.
// The Markdown body is revealed by the typewriter while this is the newest turn (`animate`),
// and where the answer is grounded in knowledge docs the attribution chips (#227) follow it
// inside the bubble. Labelled for assistive tech and bidi-isolated so the answer keeps its
// own script.
function AgentTurn({
  content,
  sources,
  animate,
}: { content: string; sources?: MessageSource[]; animate: boolean }) {
  const t = useTranslations('assistant')
  const visible = useTypewriter(content, animate)
  return (
    <div className="flex justify-start gap-[11px]">
      <AssistantMark />
      <div
        aria-label={t('answerLabel')}
        dir="auto"
        className="min-w-0 max-w-[76%] space-y-2 rounded-[14px] rounded-ss-[4px] border border-border bg-muted/40 px-[15px] py-[11px] text-body leading-[1.55] text-foreground"
      >
        <Markdown text={visible} />
        {sources && sources.length > 0 ? <SourceChips sources={sources} /> : null}
      </div>
    </div>
  )
}

// The transient "answering" indicator (ADR-0003: one synchronous call). Three dots on the
// assistant side, led by the mark; role="status" announces "Finding an answer…" once. The pulse
// is motion-safe, so prefers-reduced-motion leaves three resting dots (#226).
//
// The thinking spin (client ask, 2026-08-14): while the answer is on its way, a thin gold
// arc orbits the (B) — the mark itself holds still, so the brand never whirls, but the
// halo around it turns. The arc is a border ring with one gold edge, spun by the stock
// animate-spin slowed to a think-speed lap; motion-safe only, so reduced motion drops the
// arc and keeps the resting dots.
//
// Two alternatives were tried on 2026-08-16 and rejected by the owner — the mark itself
// turning over like a coin, then a sheen crossing a still mark. This is the one that stays.
function PendingTurn() {
  const t = useTranslations('assistant')
  return (
    <div className="flex justify-start gap-[11px]">
      <span className="relative flex-none">
        <AssistantMark />
        <span
          aria-hidden="true"
          className="absolute -inset-[3px] hidden rounded-full border-2 border-transparent border-t-nav-gold motion-safe:block motion-safe:animate-spin [animation-duration:1.4s]"
        />
      </span>
      {/* <output> carries an implicit role="status" live region — the pending label is announced
          once, and the dots inside are decorative. */}
      <output className="flex h-8 items-center" aria-label={t('thinking')}>
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

// A failed answer, shown inline where the reply would have gone (#93, ADR-0003): the question
// bubble above it is untouched, and no error turn is added to the thread — retry re-asks the
// same preserved question in place.
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

// The day chip a conversation's turns group under (The Counter, round 8): a small bordered
// pill centred between the messages — Today, Yesterday, or the turn's date.
function DayChip({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-caption font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

// Local-midnight day key, so "yesterday" means the calendar day before, not "24 hours ago".
function dayKey(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

// The conversation body: the turns in order under their day chips, then the trailing indicator
// for the current phase, then the sentinel the stick-to-bottom hook scrolls into view.
// `animatingId` names the single agent turn that should play its reveal (the newest); every
// other renders in full at once. The empty first-run state is drawn by the screen
// (ExampleChips), not here.
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
  endRef: Ref<HTMLDivElement | null>
}) {
  const t = useTranslations('assistant')
  const { locale } = useLocale()

  const now = new Date()
  const todayKey = dayKey(now.toISOString())
  const yesterdayKey = dayKey(new Date(now.getTime() - 86_400_000).toISOString())
  const chipLabel = (iso: string) => {
    const key = dayKey(iso)
    if (key === todayKey) return t('threadsToday')
    if (key === yesterdayKey) return t('threadsYesterday')
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  }

  let lastDay: string | null = null

  return (
    <div className={cn('flex flex-col gap-4')} aria-label={t('conversationLabel')}>
      {turns.map((turn) => {
        // A turn opens a new day group when its local day differs from the previous turn's;
        // a turn with no timestamp (never the persisted case) joins the group before it.
        let chip: string | null = null
        if (turn.createdAt) {
          const key = dayKey(turn.createdAt)
          if (key !== lastDay) {
            chip = chipLabel(turn.createdAt)
            lastDay = key
          }
        }
        return (
          <div key={turn.id} className="flex flex-col gap-4">
            {chip ? <DayChip label={chip} /> : null}
            {turn.role === 'user' ? (
              <UserBubble content={turn.content} />
            ) : (
              <AgentTurn
                content={turn.content}
                sources={turn.sources}
                animate={turn.id === animatingId}
              />
            )}
          </div>
        )
      })}

      {phase === 'sending' ? <PendingTurn /> : null}
      {phase === 'error' ? <RetryNotice onRetry={onRetry} /> : null}

      <div ref={endRef} />
    </div>
  )
}
