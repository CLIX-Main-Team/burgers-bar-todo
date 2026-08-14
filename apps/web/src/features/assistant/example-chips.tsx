import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { AssistantMark } from './message-list.js'

// The three example-question keys, resolved through the `assistant` namespace so each reads natively
// in Hebrew and English (never a literal translation). They are app chrome — suggestions that orient
// someone new to the Assistant — not catalogued user content; once tapped into the composer and sent,
// the question becomes the staff member's own words like any other.
const EXAMPLE_KEYS = ['example1', 'example2', 'example3'] as const

// The first-run state shown on an empty thread (#94, restyled #226): a calm invitation — the bot's
// profile picture, a warm opening line, and the resting placeholder prompt — over three tappable
// example questions. Tapping a chip does not send; it fills the composer (the screen focuses it),
// leaving the question ready to edit or send. Chips are plain outline pills (owner ask 2026-08: no
// per-chip icon); they wrap so the set stays one-handed on a narrow phone, and text-start keeps each
// label on the reading-direction edge so the whole first-run flips with `dir`.
export function ExampleChips({ onPick }: { onPick(question: string): void }) {
  const t = useTranslations('assistant')

  return (
    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
      {/* The bot's face on first run: the same (B)-on-board mark that leads every reply row
          (The Counter, round 8 — the drawn mark replaced the raster icon), a step larger so
          the first-run moment leads with the bot. */}
      <AssistantMark className="size-13 text-[1.0625rem]" />
      <h2 className="text-[1.1875rem] font-bold text-foreground">{t('emptyTitle')}</h2>
      <p className="max-w-[30ch] text-label text-muted-foreground">{t('empty')}</p>

      <div className="mt-2 flex w-full max-w-[22rem] flex-col items-stretch gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{t('examplesLabel')}</p>
        {EXAMPLE_KEYS.map((key) => {
          const question = t(key)
          return (
            <Button
              key={key}
              variant="outline"
              size="sm"
              // h-auto lets a long chip wrap to two lines; min-h-11 holds the 44px touch floor
              // (tokens.md touch targets) that size="sm"'s fixed h-11 would otherwise lose to h-auto.
              // rounded-full is the mockup's pill; justify-start keeps the label on the reading edge.
              className="h-auto min-h-11 justify-start whitespace-normal rounded-full border-border-strong py-2 text-start font-normal"
              onClick={() => onPick(question)}
            >
              {question}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
