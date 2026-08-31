import { useCallback, useEffect, useRef, useState } from 'react'
import { EXIT_MS } from './motion.js'
import { useMediaQuery } from './use-media-query.js'

// The one thing a hand-rolled modal cannot do without help (round 15, 2026-08-31). Dialog,
// AlertDialog and Sheet all portal to <body> and all end their render with `if (!open) return
// null`, so React tears them out of the DOM the instant they close and there is nothing left
// for CSS to animate. They arrived with a scale and left with a jump cut.
//
// This keeps the panel mounted for exactly as long as its exit animation runs, and hands the
// component back the flag that tells it to play that animation. Written once here because all
// three modals have the identical problem, and a fourth surface (the toast) needs it too.
//
// Under prefers-reduced-motion there IS no exit animation to wait for, so the delay collapses
// to zero and the panel unmounts as immediately as it always did. That keeps the accessibility
// bar's promise exactly: reduced motion gets the settled result at once, never a slower path.
export function useExitTransition(open: boolean, durationMs: number) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [rendered, setRendered] = useState(open)

  useEffect(() => {
    if (open) {
      setRendered(true)
      return
    }
    if (!rendered) return
    if (reducedMotion) {
      setRendered(false)
      return
    }
    const timer = window.setTimeout(() => setRendered(false), durationMs)
    // Cleared if `open` flips back before the exit finishes — a reopen during the close must
    // cancel the pending unmount, or the panel would vanish out from under the reader.
    return () => window.clearTimeout(timer)
  }, [open, rendered, reducedMotion, durationMs])

  // `closing` is true only while the panel is still on screen with its opener already gone,
  // which is precisely the window the exit animation should be playing in.
  return { rendered, closing: rendered && !open }
}

/**
 * The other half of the same problem, for a modal whose PARENT unmounts it.
 *
 * Three of this app's dialogs are mounted only while open — `{editing ? <TaskFormDialog…` —
 * and that is deliberate: unmounting is what resets their react-hook-form state between one
 * task and the next. But it also means the parent tears the whole subtree out the moment it
 * closes, and useExitTransition above never gets to hold anything: by the time `open` could
 * go false, the component that would read it is gone.
 *
 * So the closing is inverted. The dialog stops telling its parent immediately and closes
 * ITSELF first — which useExitTransition can see and animate — then reports up once the exit
 * has played and lets the parent do the unmounting it always did. The reset contract is
 * untouched; it simply happens one animation later.
 *
 * Under reduced motion there is no animation to wait for, so the parent hears about it at once.
 */
export function useDeferredClose(onClose: () => void, durationMs = EXIT_MS) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [open, setOpen] = useState(true)

  // Held in a ref so an inline `onClose={() => setSheet(null)}` — which every caller writes —
  // cannot restart the timer on each parent render and leave the dialog stranded open.
  const latest = useRef(onClose)
  useEffect(() => {
    latest.current = onClose
  })

  useEffect(() => {
    if (open) return
    if (reducedMotion) {
      latest.current()
      return
    }
    const timer = window.setTimeout(() => latest.current(), durationMs)
    return () => window.clearTimeout(timer)
  }, [open, reducedMotion, durationMs])

  return { open, close: useCallback(() => setOpen(false), []) }
}
