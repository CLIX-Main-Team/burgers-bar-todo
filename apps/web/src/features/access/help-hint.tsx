import { useId, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { cn } from '../../lib/cn.js'

// The "?" beside a heading (owner ask 2026-08-26, revised the same day: "should show the text
// when hovering not when clicking"). So it opens on hover and on keyboard focus — and still on
// tap, because a phone has no hover and a help affordance that only answers a mouse is no help
// on the surface where somebody is most likely to be unsure (UX rule: never rely on hover alone).
//
// It answers the two pointers in two different shapes, because the objection to each is
// different. A hovered panel FLOATS: an explanation that pushed the page down every time the
// pointer crossed it would make the layout twitch under the reader's hand. A tapped panel sits
// in the FLOW, on its own line under the heading — a phone has no room for a floating 22rem
// card, and anchoring one to a 20px button that sits mid-line runs it straight off the screen.
// A tap is a deliberate ask, so moving the page in answer to it is honest rather than jumpy.
//
// The wrapper is `display: contents` until `sm` so the panel becomes a flex item of the heading
// row itself and can claim a whole line of it; from `sm` it is the positioning parent instead.
// Both halves need their parent row to allow wrapping.
export interface HelpHintProps {
  // The message key the "?" reveals.
  textKey: string
  // Names the thing being explained, for the button's accessible label.
  subject: string
  className?: string
}

export function HelpHint({ textKey, subject, className }: HelpHintProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  // A tap fires focus AND click, in that order. Without knowing which pointer opened it, the
  // focus would open the panel and the click that produced that focus would immediately shut
  // it again — the touch path, the one case hover cannot serve, would be the only broken one.
  // Cleared on blur, or a touchscreen laptop would stop answering its own keyboard.
  const touching = useRef(false)

  return (
    <span className={cn('contents sm:relative sm:inline-flex', className)}>
      <button
        type="button"
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={t('access.explain', { subject })}
        onPointerDown={(event) => {
          touching.current = event.pointerType !== 'mouse'
        }}
        onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === 'mouse' && setOpen(false)}
        // Keyboard focus opens it; focus that merely followed a tap leaves it to the click.
        onFocus={() => !touching.current && setOpen(true)}
        onBlur={() => {
          touching.current = false
          setOpen(false)
        }}
        onClick={() => setOpen((was) => !was)}
        className={cn(
          'inline-flex size-5 flex-none items-center justify-center rounded-full border text-caption font-bold transition-colors motion-reduce:transition-none',
          open
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        <span aria-hidden>?</span>
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className="mt-1.5 basis-full rounded-lg border border-border bg-card px-3 py-2 text-label leading-snug text-muted-foreground shadow-md sm:absolute sm:top-full sm:start-0 sm:z-30 sm:w-[22rem] sm:basis-auto"
        >
          {t(textKey)}
        </span>
      )}
    </span>
  )
}
