import type { ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '../../lib/cn.js'

// The app's hover line (owner call 2026-08-27), replacing the browser's own `title` bubble on
// controls that need one. The native tooltip could not be styled, appeared after a second of
// nothing, and — the reason it had to go — is never shown at all on a DISABLED control, because a
// disabled element carries `pointer-events: none` and is never hit-tested. That is exactly when a
// lone glyph most needs a name: the scan button is dimmed until a title is typed, so the one
// question it raises ("why can't I press this?") had no answer.
//
// Deliberately small. This is a label, not a popover: no interactive content, no delay worth
// tuning, no portal. Wrapping the trigger rather than cloning it keeps it usable over a disabled
// control, since the events land on the wrapper.

interface TooltipProps {
  // The line to show. The wrapped control is expected to carry the SAME string as its aria-label,
  // so the bubble itself is hidden from assistive tech — otherwise every reader announces it twice.
  label: string
  children: ReactNode
  className?: string
}

export function Tooltip({ label, children, className }: TooltipProps) {
  const [shown, setShown] = useState(false)

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => setShown(true)}
      onPointerLeave={() => setShown(false)}
      // Pressing means the person has stopped asking what the control is and started using it, so
      // both ways of pressing dismiss it. Pointer-down covers touch, where a tap fires
      // pointerenter with no leave to follow it. Click covers the keyboard, where there is no
      // pointer at all — and where blur cannot be relied on either, since a control that disables
      // itself on activation drops focus to the body without React ever seeing it. Without this
      // the bubble stayed open across a twenty-second wait, on top of the line reporting it.
      onPointerDown={() => setShown(false)}
      onClickCapture={() => setShown(false)}
      // Capture, because focus and blur do not bubble: the control inside is what receives them.
      onFocusCapture={() => setShown(true)}
      onBlurCapture={() => setShown(false)}
    >
      {children}
      {shown ? (
        <span
          aria-hidden="true"
          className={cn(
            // Below the trigger, and anchored to the row's END rather than centred on it. The
            // sheet scrolls, which makes it a clipping box on BOTH axes, and every control that
            // wants a hover line sits at the end of its row — centred, a forty-character line
            // would run off the card and be cut in half.
            // The drop is measured from the TRIGGER, which in a row of taller controls sits
            // inset from the row's own bottom edge — so the offset is a little more than the air
            // it wants to leave under whatever it hangs beneath.
            'pointer-events-none absolute end-0 top-[calc(100%+0.95rem)] z-20 whitespace-nowrap',
            'rounded-md bg-foreground px-2.5 py-1.5 text-caption font-semibold text-background shadow-md',
            'motion-safe:animate-tip-in',
          )}
        >
          {/* The stem. A rotated square of the same ink, tucked under the bubble's end so it
              points back at the control the line is about.
              The offset is derived, not eyeballed. An icon button is `p-2` around a `size-5`
              glyph, so its centre sits `0.5rem + 0.625rem = 1.125rem` in from its own end; the
              stem is `size-2`, so its box must start a quarter-rem short of that. In rem rather
              than pixels because the app steps its root font-size by breakpoint — a pixel
              constant lands on the button's centre at exactly one screen width and drifts at
              every other. */}
          <span className="absolute -top-1 end-[0.875rem] size-2 rotate-45 rounded-[1px] bg-foreground" />
          <span className="relative">{label}</span>
        </span>
      ) : null}
    </span>
  )
}
