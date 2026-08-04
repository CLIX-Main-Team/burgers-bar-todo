import { useCallback, useEffect, useRef } from 'react'

// Keep the conversation pinned to its newest content as turns arrive and the typewriter reveal grows
// the last answer (#93) — the stick-to-bottom behaviour cherry-lifted from the CRM's chat, rebuilt
// as a framework-agnostic helper over the window scroll the shell already uses (a single scrolling
// column, not a bounded inner pane). It pins only while the reader is already at the bottom: someone
// who scrolled up to re-read an earlier answer is never yanked back down.
//
// Return an `endRef` to place on a sentinel node at the end of the message list. The hook watches
// that sentinel's parent for size changes (a new turn, the thinking indicator, a mid-reveal answer)
// and scrolls the sentinel into view when pinned; it also re-pins on the `signal` the caller bumps
// whenever conversation state changes, covering the rare growth a resize does not report.
const NEAR_BOTTOM_PX = 96

function scrollingElement(): Element {
  return document.scrollingElement ?? document.documentElement
}

export function useStickToBottom(signal: unknown) {
  const endRef = useRef<HTMLDivElement | null>(null)
  // True while the reader is at (or near) the bottom. Starts pinned: an empty conversation is at its
  // bottom, and the first question should scroll into view.
  const pinnedRef = useRef(true)

  const recomputePinned = useCallback(() => {
    const el = scrollingElement()
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
  }, [])

  const stick = useCallback(() => {
    if (pinnedRef.current) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [])

  // Track the reader's position so growth only pins someone who has not scrolled away.
  useEffect(() => {
    window.addEventListener('scroll', recomputePinned, { passive: true })
    return () => window.removeEventListener('scroll', recomputePinned)
  }, [recomputePinned])

  // Stick on each conversation state change (new turn, sending → idle, error).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signal` is the intended trigger.
  useEffect(() => {
    stick()
  }, [signal, stick])

  // Stick while content grows under a running reveal, where no new turn fires: observe the list box
  // so a mid-reveal answer stays in view. Guarded for environments without ResizeObserver (jsdom).
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const parent = endRef.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => stick())
    observer.observe(parent)
    return () => observer.disconnect()
  }, [stick])

  return endRef
}
