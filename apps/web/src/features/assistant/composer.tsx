import { type KeyboardEvent, useState } from 'react'
import { useTranslations } from 'use-intl'
import { Button } from '../../components/ui/button.js'
import { Icon } from '../../components/ui/icon.js'

// The question composer (#93): a growing single-to-multiline field and the send action. Enter sends,
// Shift+Enter inserts a newline — the phone-and-keyboard convention — and an empty or whitespace-only
// question never sends. While an answer is in flight the whole composer is disabled so a second
// question cannot race the one synchronous exchange (ADR-0003). The field text is the staff member's
// own words: it is never catalogued, only its chrome (placeholder, labels) is.
export function Composer({
  onSend,
  disabled,
}: {
  onSend(question: string): void
  disabled: boolean
}) {
  const t = useTranslations('assistant')
  const [value, setValue] = useState('')

  const submit = () => {
    const question = value.trim()
    if (question === '' || disabled) return
    onSend(question)
    setValue('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        aria-label={t('inputLabel')}
        placeholder={t('placeholder')}
        // text-base holds the 16px input floor (tokens.md Typography) — below it iOS auto-zooms a
        // focused field; text-start so the caret and placeholder sit on the reading-direction edge.
        className="max-h-40 min-h-12 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-3 text-start text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        disabled={disabled}
      />
      <Button
        type="submit"
        size="icon"
        aria-label={t('send')}
        disabled={disabled || value.trim() === ''}
      >
        <Icon name="send" />
      </Button>
    </form>
  )
}
