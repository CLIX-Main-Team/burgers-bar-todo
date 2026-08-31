import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'
import { EXIT_MS } from '../../lib/motion.js'
import { useExitTransition } from '../../lib/use-exit-transition.js'
import { Button } from './button.js'
import { Icon } from './icon.js'

// A panel that slides in from an edge over a scrim (issue #215, components.md §Sheet). It
// carries the create-and-edit task form today, and — reused by later slices — the account menu
// and the thread list. The flagship board graduates the DS's "Sheet is bottom-anchored" default
// into a responsive rule this primitive owns: a bottom sheet below `md` (thumb zone, a drag
// handle, radius-xl leading — top — corners) and an inline-end drawer from `md` (min(30rem,…)
// wide, full height, radius-xl leading — inline-start — corners), both over the same scrim and
// both the same contents. A bottom sheet rising the full height of a wide monitor reads wrong;
// a side drawer keeps the board visible beside the form.
//
// It owns the behaviours a modal panel must carry so no call site re-implements them: a scrim
// press and Escape both close, focus is trapped inside while open and returned to the opener on
// close, and body scroll is locked so the board behind does not scroll under the sheet. Tokens:
// card surface, radius-xl leading corners, elevation-lg, a scrim over the page.
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  // The sheet's heading, which also names the dialog to assistive tech.
  title: string
  children: ReactNode
}) {
  const t = useTranslations('common')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  // Park focus on the first focusable control when the sheet opens, and restore focus to the
  // element that opened it on close, so a keyboard user is not dropped at the top of the page.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    // Lock body scroll while the sheet is open; restore the prior value on close.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open])

  // A sheet thrown out by a finger is already most of the way gone, and its inline transform
  // is mid-flight; replaying a keyframe from the resting position would snap it back up first.
  // So the throw finishes itself under the panel's own transition and skips the keyframe, and
  // only the other three exits — Escape, the scrim, the close button — animate.
  const thrown = useRef(false)
  if (open) thrown.current = false

  const { rendered, closing } = useExitTransition(open, EXIT_MS)

  if (!rendered) return null

  // Keep Tab within the sheet (a minimal focus trap over the panel's focusable controls); Escape
  // closes. A nested modal that portals out of the panel (the delete AlertDialog) receives its own
  // key events, so this handler never fights it — it only sees events bubbling inside the panel.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Dragging the handle pulls the panel down with the finger; releasing past the threshold
  // closes, anything shorter springs back. Listeners go on the window for the drag's duration so
  // the gesture survives leaving the small handle (jsdom also lacks setPointerCapture).
  const beginHandleDrag = (down: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (!panel) return
    down.preventDefault()
    const originY = down.clientY
    panel.style.transition = 'none'
    const move = (event: PointerEvent) => {
      panel.style.transform = `translateY(${Math.max(0, event.clientY - originY)}px)`
    }
    const settle = (isClosing: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', cancel)
      panel.style.transition = ''
      if (isClosing) {
        // Carry the throw the rest of the way under the transition the drag just restored,
        // rather than cutting it off where the finger let go. See `thrown` above.
        thrown.current = true
        panel.style.transform = 'translateY(100%)'
        onClose()
      } else panel.style.transform = ''
    }
    const release = (event: PointerEvent) => settle(event.clientY - originY > 80)
    const cancel = () => settle(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', cancel)
  }

  // Portal to <body> so the fixed overlay escapes any ancestor that establishes a containing
  // block (a transformed sortable card the edit sheet may open from would otherwise clip it).
  return createPortal(
    <div className={cn('fixed inset-0 z-40', closing && 'pointer-events-none')}>
      {/* The scrim; a press on it closes, matching Escape. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className={cn(
          'absolute inset-0 cursor-default bg-scrim',
          closing ? 'motion-safe:animate-scrim-out' : 'motion-safe:animate-scrim-in',
        )}
        onClick={onClose}
      />
      {/* role="dialog" is the correct ARIA for this hand-rolled modal — a native <dialog> would
          re-implement the scrim and responsive anchoring the Sheet already owns. (biome's
          useSemanticElements is off for this file in biome.json.) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        // Bottom sheet below md; inline-end drawer from md. Logical properties throughout, so the
        // drawer sits at the inline-end — the left in Hebrew, the right in English — and its
        // leading (inline-start) corners round, with no direction-specific CSS. On mobile it caps
        // at 90% height and scrolls inside; from md it fills the viewport height (top-0 + the
        // inherited bottom-0) so a long form scrolls within the drawer rather than off-screen.
        className={cn(
          'absolute bottom-0 start-0 end-0 z-50 flex max-h-[90%] flex-col overflow-y-auto rounded-t-xl bg-card p-6 text-card-foreground shadow-lg motion-safe:transition-transform md:top-0 md:start-auto md:max-h-none md:w-[min(30rem,86%)] md:rounded-t-none md:rounded-s-xl',
          // The panel is two things at two widths, so it arrives from two different edges: up
          // off the bottom as a phone sheet, in from the inline end as a desktop drawer. The
          // drawer's edge is the left one in Hebrew; --bb-drawer-from carries that.
          !closing && 'motion-safe:animate-sheet-in md:motion-safe:animate-drawer-in',
          closing &&
            !thrown.current &&
            'motion-safe:animate-sheet-out md:motion-safe:animate-drawer-out',
        )}
      >
        {/* The drag handle: a swipe down on it dismisses the bottom sheet. The strip is taller
            than the pill for a thumb-sized target, touch-none so the browser doesn't claim the
            gesture for scrolling, and pointer-only (aria-hidden) — keyboard users have Escape and
            the close button. Bottom sheet only, so the desktop drawer hides it. */}
        <div
          aria-hidden
          onPointerDown={beginHandleDrag}
          className="-mt-4 mb-1 shrink-0 cursor-grab touch-none py-3 md:hidden"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="mb-6 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-heading-sm font-semibold text-foreground">
            {title}
          </h2>
          <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
