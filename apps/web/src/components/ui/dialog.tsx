import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'
import { Icon } from './icon.js'

// The centred form modal (The Counter, round 8): a card floating over a dimmed page, for
// the small write flows that used to live as inline cards — invite a person, add a branch,
// rename one. AlertDialog stays the two-button confirm for destructive actions; this one
// carries a form as `children` and the form owns its own footer buttons.
//
// Same containment contract as AlertDialog: portal to <body> (a transformed ancestor would
// otherwise clip the fixed overlay), Escape and a scrim press both close, Tab cycles inside,
// and focus returns to the opener on close. Focus lands on the first field rather than a
// cancel button — the caller opened this to type.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  hideTitle = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
  // The dialog's own heading is hidden but still announced, for a form whose first field
  // IS the title (the task dialog): a chrome heading over a large title input says the same
  // word twice. The name stays in the accessibility tree either way.
  hideTitle?: boolean
}) {
  const t = useTranslations()
  const closeLabel = t('common.close')
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    // The close button is skipped so focus still lands on the first real field: it sits early
    // in the DOM (it is drawn in the corner) and would otherwise win every time.
    dialogRef.current
      ?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([disabled]):not([data-dialog-close])',
      )
      ?.focus()
    return () => previouslyFocused?.focus()
  }, [open])

  // Escape closes from anywhere — listened at the document, not the dialog, so it still
  // works when a submit's brief disabled state dropped focus to the body.
  useEffect(() => {
    if (!open) return
    const onDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [open, onClose])

  if (!open) return null

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]',
    )
    const first = focusable?.[0]
    const last = focusable?.[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* The scrim — one warm black wash in both themes; a press on it closes, matching
          Escape. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-scrim"
        onClick={onClose}
      />
      {/* A positioned div with role="dialog", not the native <dialog> element — the same
          hand-rolled portal pattern AlertDialog and Sheet ship (native <dialog> brings its
          own top-layer, ::backdrop, and open/close state that would fight the portal +
          scrim composition here); the a11y rule is off for this file in biome.json, the
          same carve-out select.tsx and sheet.tsx carry. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          'relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-[28.75rem] overflow-y-auto rounded-[14px] bg-card px-7 py-[26px] text-card-foreground shadow-lg',
          className,
        )}
      >
        <h2
          id={titleId}
          className={cn(hideTitle ? 'sr-only' : 'text-heading-md font-bold text-foreground')}
        >
          {title}
        </h2>
        {/* A way out you can see (2026-08-21). Escape and a press on the scrim have always
            closed this, but neither is visible, and on a phone there is no Escape key at all
            — the dialog simply had no exit anybody could point at. */}
        <button
          type="button"
          data-dialog-close
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute end-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="close" size="sm" />
        </button>
        {description ? (
          <p id={descId} className="mt-1 text-label text-muted-foreground">
            {description}
          </p>
        ) : null}
        <div className={cn(hideTitle && !description ? '' : 'mt-5')}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
