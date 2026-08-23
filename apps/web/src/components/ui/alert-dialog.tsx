import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './button.js'

// The confirmation modal for a destructive or irreversible action (issue #213,
// components.md §AlertDialog): delete a task, and — reused by later slices — revoke an
// invite, deactivate a user, delete a thread, log out of all devices. Two actions: a destructive confirm and a
// secondary cancel, with cancel the default focus so a stray tap or Enter does not destroy.
// Escape and a scrim press both cancel. Focus is kept inside the dialog while it is open
// (a minimal Tab cycle) and returned to wherever it came from on close, so the keyboard path
// is reversible. Tokens: popover surface, radius-lg, elevation-lg, a scrim over the page.
export function AlertDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  confirmDisabled?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descId = useId()

  // Park focus on Cancel when the dialog opens (the safe default), and restore focus to the
  // element that opened it when it closes, so a keyboard user is not dropped at the top.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [open])

  if (!open) return null

  // Keep Tab within the dialog; Escape cancels. A small manual trap is enough for the two
  // controls this dialog ever holds.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
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

  // Portal to <body> so the fixed overlay escapes any ancestor that establishes a containing
  // block — the sortable card the delete confirm opens from carries a transform, which would
  // otherwise clip a fixed descendant.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* The scrim; a press on it cancels, matching Escape. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-scrim"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={onKeyDown}
        // An explicit max width — the project's named spacing tokens repoint Tailwind's
        // `max-w-sm` at --spacing-sm (0.75rem), so the container-scale name cannot be used here.
        className="relative z-10 w-full max-w-[24rem] rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg"
      >
        <h2 id={titleId} className="text-heading-sm font-semibold text-foreground">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-2 text-body text-muted-foreground">
            {description}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
