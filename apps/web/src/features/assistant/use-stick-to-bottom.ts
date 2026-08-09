import { useCallback, useEffect, useRef } from 'react'

// Keep the conversation pinned to its newest content as turns arrive and the typewriter reveal grows
// the last answer (#93) — the stick-to-bottom behaviour cherry-lifted from the CRM's chat. It targets
// the chat's own scrolling pane (the ChatGPT-style layout, owner ask 2026-08: the messages scroll in
// a bounded container while the composer below never moves), not the window. It pins only while the
// reader is already at the bottom: someone who scrolled up to re-read an earlier answer is never
// yanked back down.
//
// Returns two callback refs: `scrollRef` for the scrolling pane and `endRef` for a sentinel at the
// end of the message list. Callback refs rather than effects so the listeners survive the pane
// remounting when the screen's rail/Sheet layout flips across `lg` mid-session. The sentinel's
// parent is watched for size changes (a new turn, the thinking indicator, a mid-reveal answer) and
// the pane is scrolled to its bottom when pinned; the caller also bumps `signal` on conversation
// state changes, covering the rare growth a resize does not report.
const NEAR_BOTTOM_PX = 96

export function useStickToBottom(signal: unknown) {
  // True while the reader is at (or near) the bottom. Starts pinned: an empty conversation is at its
  // bottom, and the first question should scroll into view.
  const pinnedRef = useRef(true)
  const paneRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const recomputePinned = useCallback(() => {
    const pane = paneRef.current
    if (pane) {
      pinnedRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight <= NEAR_BOTTOM_PX
    }
  }, [])

  const stick = useCallback(() => {
    const pane = paneRef.current
    if (pane && pinnedRef.current) {
      pane.scrollTop = pane.scrollHeight
    }
  }, [])

  // Track the reader's position so growth only pins someone who has not scrolled away.
  const scrollRef = useCallback(
    (pane: HTMLDivElement | null) => {
      paneRef.current?.removeEventListener('scroll', recomputePinned)
      paneRef.current = pane
      if (pane) {
        pane.addEventListener('scroll', recomputePinned, { passive: true })
        // A freshly mounted pane starts pinned — a layout flip lands showing the newest turn.
        pinnedRef.current = true
        stick()
      }
    },
    [recomputePinned, stick],
  )

  // Stick while content grows under a running reveal, where no new turn fires: observe the list box
  // holding the sentinel so a mid-reveal answer stays in view. Guarded for environments without
  // ResizeObserver (jsdom).
  const endRef = useCallback(
    (sentinel: HTMLDivElement | null) => {
      observerRef.current?.disconnect()
      observerRef.current = null
      const parent = sentinel?.parentElement
      if (parent && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(() => stick())
        observer.observe(parent)
        observerRef.current = observer
      }
    },
    [stick],
  )

  // Re-pin on the reader's own actions: asking a question or opening a thread means "show me the
  // newest turn", even from halfway up an old answer. The immediate stick is best-effort; the real
  // scroll lands via the `signal` effect after the new content renders, now that the pin is set.
  const jumpToBottom = useCallback(() => {
    pinnedRef.current = true
    stick()
  }, [stick])

  // Stick on each conversation state change (new turn, sending → idle, error).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `signal` is the intended trigger.
  useEffect(() => {
    stick()
  }, [signal, stick])

  return { scrollRef, endRef, jumpToBottom }
}
