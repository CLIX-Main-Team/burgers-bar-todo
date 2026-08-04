import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'

// The three example-question keys, resolved through the `assistant` namespace so each reads natively
// in Hebrew and English (never a literal translation). They are app chrome — suggestions that orient
// someone new to the Assistant — not catalogued user content; once tapped into the composer and sent,
// the question becomes the staff member's own words like any other.
const EXAMPLE_KEYS = ['example1', 'example2', 'example3'] as const

// The example-question chips shown on an empty thread (#94): a short prompt and a few tappable
// questions that populate the composer so a first-time user knows what they can ask. Tapping a chip
// does not send — it fills the field (the screen focuses it), leaving the question ready to edit or
// send. Wrapping chips keep the row one-handed on a narrow phone, and text-start keeps each label on
// the reading-direction edge so the set flips whole with `dir`.
export function ExampleChips({ onPick }: { onPick(question: string): void }) {
  const t = useTranslations('assistant')

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('examplesLabel')}
      </p>
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_KEYS.map((key) => {
          const question = t(key)
          return (
            <Button
              key={key}
              variant="outline"
              size="sm"
              // h-auto lets a long chip wrap to two lines; min-h-11 holds the 44px touch floor
              // (tokens.md touch targets) that size="sm"'s fixed h-11 would otherwise lose to h-auto.
              className="h-auto min-h-11 whitespace-normal py-2 text-start font-normal"
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
