import type { ReactNode, Ref } from 'react'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'
import { delayStyle } from '../../lib/motion.js'
import { AssistantMark } from './message-list.js'

// The conversation region, shared by the desktop card and the phone column (round 11,
// 2026-08-23). It owns the one piece of choreography this screen has: on a fresh thread the
// composer sits at the middle of the surface under the brand mark and the opening line — the
// shape every assistant people already use opens with — and the moment the first question is
// asked it glides down to the foot and the conversation opens above it.
//
// The glide is a three-row grid whose LAST row evaporates:
//
//     [ minmax(0,1fr) ]  the conversation (and, stacked over it, the opening)
//     [ auto          ]  the composer
//     [ 1fr -> 0fr    ]  the tail
//
// The composer never moves in the DOM and nothing is measured: the space beneath it is what
// animates, and gravity does the rest. That is what makes this survive a resize, an RTL flip
// and a font swap for free, where a FLIP transform would have to be recomputed for each.
// `grid-template-rows` is interpolable, so one transition drives the whole move; a browser
// that cannot interpolate it simply snaps, which is the correct degradation.
//
// The opening is stacked OVER the conversation in row 1 rather than swapped with it, so the
// two crossfade instead of one popping in after the other. It leaves faster (300ms) than the
// composer travels (600ms) — the invitation clears before the working surface settles.
//
// Everything motion-safe: under prefers-reduced-motion the layout still changes, it just
// arrives without the journey.
// The Assistant's arrival (round 15 rev 2, 2026-08-31, owner ask: an entrance of its own, "not
// similar to other pages", that still belongs to the system).
//
// Every other page in the app RISES, because every other page is a list of things, and a list
// arrives from somewhere. This page is not a list. It is one invitation on an empty surface, and
// the thing that makes it itself is the warm light behind the composer. So it BLOOMS instead: the
// light comes up first, over the full arrival length, and the four things that matter emerge
// inside it, top to bottom. Same durations and the same curve as everywhere else, different
// sentence — which is the whole brief.
//
// The light is not in the sequence below because it is not a step in it: it runs underneath the
// entire thing from 0, and the numbers here are what emerges into it.
const SCORE = {
  mark: 100,
  greeting: 180,
  subline: 240,
  composer: 300,
}

export function ConversationPane({
  docked,
  chromed,
  scrollRef,
  messages,
  composer,
}: {
  // True once the thread has anything in it: the composer belongs at the foot. False is the
  // opening state. Driving both states off one flag is what lets the reverse (New chat) play
  // the same move backwards without a second code path.
  docked: boolean
  // True inside the desktop card, which pays for its own padding and closes the composer off
  // under a hairline; false in the phone column, where the shell's padding already applies.
  chromed: boolean
  scrollRef: Ref<HTMLDivElement | null>
  messages: ReactNode
  composer: ReactNode
}) {
  const t = useTranslations('assistant')

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1',
        docked ? 'grid-rows-[minmax(0,1fr)_auto_0fr]' : 'grid-rows-[minmax(0,1fr)_auto_1fr]',
        'motion-safe:transition-[grid-template-rows] motion-safe:duration-[600ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      {/* Row 1 — the conversation and the opening, stacked in one cell. `z-10` keeps both
          above the warm wash anchored to the composer below, which reaches up into this row. */}
      <div className="relative z-10 grid min-h-0 grid-cols-1 grid-rows-1">
        <div
          ref={scrollRef}
          className={cn('col-start-1 row-start-1 min-h-0 overflow-y-auto', chromed && 'px-6 py-5')}
        >
          <div className="mx-auto flex w-full max-w-[42rem] flex-col gap-4">{messages}</div>
        </div>

        {/* The opening: the mark at hero scale over the greeting, sitting on the floor of the
            row so it reads as one block with the composer directly beneath it. Never
            interactive — the composer is the only thing to act on here — so it stays
            pointer-transparent and drops out of the a11y tree once the thread is under way.
            Mark, greeting, sub-line, field. The sub-line was cut with the example chips and
            restored a beat later — "a bit blank" without it — but generic this time: it lists
            no topics, so nothing here goes stale as the knowledge base grows. It carries the
            grounding promise the removed copy used to ("find the answer" = looked up, not
            invented), which matters most below `lg`, where there is no chat header and this
            is the only line that makes that claim at all.
            The four elements divide the work and none of them repeats another: the mark says
            whose surface this is, the greeting opens, the sub-line says what the box is FOR,
            and the placeholder only says the box is empty and yours ("Write something…").
            When the sub-line was briefly gone the placeholder had to carry its job too and
            read "Ask anything…"; with the sub-line back that would be two asks on one small
            screen. If this line is ever cut again, the placeholder has to take the job back. */}
        <div
          aria-hidden={docked}
          className={cn(
            'pointer-events-none col-start-1 row-start-1 flex flex-col items-center justify-end gap-3 px-4 pb-7 text-center',
            docked ? 'opacity-0 motion-safe:-translate-y-3' : 'opacity-100',
            'motion-safe:transition-[opacity,transform] motion-safe:duration-300 motion-safe:ease-out',
          )}
        >
          {/* Scale rather than travel, so the mark reads as coming INTO focus rather than
              arriving from off-screen. That distinction is what separates this page's entrance
              from every other one's. */}
          <span className="motion-safe:animate-emerge" style={delayStyle(SCORE.mark)}>
            <AssistantMark className="size-[4.5rem]" />
          </span>
          <h2
            className="text-hero font-extrabold text-foreground motion-safe:animate-rise"
            style={delayStyle(SCORE.greeting)}
          >
            {t('emptyTitle')}
          </h2>
          <p
            className="max-w-[34ch] text-label text-muted-foreground motion-safe:animate-rise"
            style={delayStyle(SCORE.subline)}
          >
            {t('empty')}
          </p>
        </div>
      </div>

      {/* Row 2 — the composer, and the wash it carries with it. The hairline above it belongs
          to the docked state only: a rule under a composer floating at the middle of the
          surface would be drawing a floor where there is no floor. */}
      <div
        className={cn(
          'relative isolate',
          chromed ? 'border-t px-4.5 py-3.5' : 'border-t pt-3',
          docked ? 'border-border' : 'border-transparent',
          'motion-safe:transition-colors motion-safe:duration-300',
        )}
      >
        {/* The warm wash. It lives in the composer's own row, so it TRAVELS with the composer
            for free — the light follows the question down as the composer docks. `isolate` on
            the row keeps the negative z-index inside this stacking context, so it paints over
            the card's ground rather than under it.
            The box is sized to the composer, not the surface: the glow belongs to the thing
            you are about to type into (owner call, rev 2 — "just a subtle background color
            around the input").
            Rev 3, 2026-08-30: it was 30rem tall, which at a phone's width is taller than it is
            wide, so the gradient's ellipse rendered as a DISC floating behind the page rather
            than as light on the input — the owner read it as "a blue circle". It is now roughly
            the composer's height plus a halo, so the ellipse is far wider than it is tall and
            the light hugs the field it belongs to.
            Rev 4, same day: rev 3's ellipse was wider than the box that carried it, so the fade
            was still visibly on when it hit the screen edge and the halo ended in a straight
            line — "it looks cut". The gradient is inscribed in this box now (index.css), so this
            height is what sets the halo's reach: tall enough to clear the field, short enough
            that the light stays the input's rather than the page's. It leaves ENTIRELY once the thread is under way rather than
            dimming to an ember, which was rev 1's answer — a conversation with a permanent
            tint behind it is a tinted conversation, and the ambience is the invitation's, not
            the transcript's. */}
        <div
          aria-hidden
          className={cn(
            'bb-assistant-wash pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-[12rem] -translate-y-1/2',
            docked ? 'opacity-0' : 'opacity-100',
            'motion-safe:transition-opacity motion-safe:duration-[600ms]',
            // Only on the open surface. Arriving into a thread already under way, the wash is
            // supposed to be gone, and an entrance would flash it on before hiding it again.
            !docked && 'motion-safe:animate-bloom',
          )}
        />
        <div
          className={cn('mx-auto w-full motion-safe:animate-rise', chromed && 'max-w-[46rem]')}
          style={delayStyle(SCORE.composer)}
        >
          {composer}
        </div>
      </div>

      {/* Row 3 — the tail. Empty on purpose: this is the space whose collapse IS the animation. */}
      <div aria-hidden className="min-h-0" />
    </div>
  )
}
