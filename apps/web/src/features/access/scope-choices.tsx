import { type ScopeChoice, VIEW_SCOPE_CHOICES, type ViewScopeKey } from '@burgers/shared'
import { useId } from 'react'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'
import { SCOPE_LABEL_KEY } from './capabilities.js'

// How far a role sees, as a set of pills rather than a dropdown (owner call 2026-08-26, second
// pass). A horizon has two or three answers, never more — and a dropdown that hides two options
// behind a click to save a line of space is a bad trade on the one page whose whole job is
// showing somebody what the rules ARE. Open, all the answers are on screen; the chosen one is
// simply the one wearing the ink.
//
// Real radio inputs under the pills, so arrow keys move between them, the group is announced as
// one choice, and the browser does the state work. The selected pill is carried by border,
// weight AND ground rather than colour alone (WCAG 1.4.1).
export interface ScopeChoicesProps {
  scopeKey: ViewScopeKey
  value: ScopeChoice
  disabled: boolean
  // Names the group to assistive tech — the row's own label, which sits above.
  label: string
  onChange: (choice: ScopeChoice) => void
}

export function ScopeChoices({ scopeKey, value, disabled, label, onChange }: ScopeChoicesProps) {
  const t = useTranslations()
  // Unique per rendered group: the same horizon is drawn again the moment the owner switches
  // role tabs, and two radio groups sharing a name would fight over one selection.
  const name = useId()

  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {VIEW_SCOPE_CHOICES[scopeKey].map((choice) => {
          const checked = choice === value
          return (
            <label
              key={choice}
              className={cn(
                // font-semibold in BOTH states: picking one used to take it from 300 to 600,
                // which re-measured the label and nudged its neighbours along the row by 2-3px
                // — the same jump the tab strip was deliberately built to avoid. The weight
                // never moves; the fill says which one is picked.
                'group relative inline-flex min-h-8 cursor-pointer items-center rounded-lg border px-2.5 text-label font-semibold transition-colors motion-reduce:transition-none',
                // Chosen is the solid action blue, the same mark the role tabs above these
                // carry (owner call 2026-08-27: one colour for every "this one"). These used
                // to say it in a 10%-alpha blue TINT, which is a different statement from a
                // filled chip and left one screen answering "which is picked?" two ways.
                checked
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-strong bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-60 hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                value={choice}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(choice)}
                className="sr-only peer"
              />
              {/* The focus ring rides the pill, since the input itself is off-screen. */}
              <span
                aria-hidden
                className="absolute -inset-px rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
              />
              {t(SCOPE_LABEL_KEY[scopeKey][choice] as string)}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
