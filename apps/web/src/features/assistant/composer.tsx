import type { KeyboardEvent, RefObject } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'

// The question composer (#93, restyled #226): a growing single-to-multiline field and the send action,
// held in a card-ground, input-bordered radius-xl bar. Enter sends, Shift+Enter inserts a newline —
// the phone-and-keyboard convention — and an empty or whitespace-only question never sends. While an
// answer is in flight the whole composer is disabled so a second question cannot race the one
// synchronous exchange (ADR-0003), and the round primary Send shows its loading state. The field text
// is the staff member's own words: it is never catalogued, only its chrome (placeholder, labels) is.
//
// The value is owned by the screen (#94), not held here: an example-question chip populates the
// composer by setting that state, and the screen clears it on send. `inputRef` lets the screen focus
// the field after a chip tap, so a populated question is ready to edit or send without a second reach.
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  sending,
  inputRef,
}: {
  value: string
  onChange(value: string): void
  onSend(question: string): void
  disabled: boolean
  // True only while a message is in flight (distinct from `disabled`, which also covers loading a
  // thread's history): drives the Send button's loading spinner.
  sending?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const t = useTranslations('assistant')

  const submit = () => {
    const question = value.trim()
    if (question === '' || disabled) return
    onSend(question)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      // The bar itself carries the border and the focus ring (focus-within), so the field inside reads
      // borderless — the composer is one object, not a field beside a button (components.md §Composer).
      className="flex items-end gap-2 rounded-xl border border-input bg-card py-1.5 pe-1.5 ps-3.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        aria-label={t('inputLabel')}
        placeholder={t('placeholder')}
        // text-base holds the 16px input floor (tokens.md Typography) — below it iOS auto-zooms a
        // focused field; text-start so the caret and placeholder sit on the reading-direction edge.
        // The field is transparent and ringless — the surrounding bar owns the surface and the focus
        // ring — and grows to a few lines (max-h-40) then scrolls.
        className="max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-start text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        disabled={disabled}
      />
      <Button
        type="submit"
        size="icon"
        aria-label={t('send')}
        // Round primary Send at the touch minimum; the primary variant already drops to the muted
        // surface when disabled (empty field or in flight), matching the mockup's resting Send.
        className="flex-none rounded-full"
        disabled={disabled || value.trim() === ''}
      >
        {sending ? (
          <span
            aria-hidden="true"
            className="size-5 rounded-full border-2 border-current border-e-transparent motion-safe:animate-spin"
          />
        ) : (
          <Icon name="send" />
        )}
      </Button>
    </form>
  )
}
