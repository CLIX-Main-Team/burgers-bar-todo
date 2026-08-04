import { useEffect, useRef, useState } from 'react'

// The cosmetic typewriter reveal (#93, ADR-0003). The answer is returned whole in one synchronous
// response — there is no real token stream — so this is purely a reveal animation played over the
// already-known text: a nod to the CRM's streamed feel without adopting its async-write pipeline.
//
// It is time-boxed, not per-character, so a long procedure still completes in the same brief window
// rather than crawling for seconds. A reader who prefers reduced motion, or any environment without
// a real animation frame, gets the whole answer at once — the reveal is decoration, never a gate on
// reading the content.
const REVEAL_MS = 650

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Given the full answer text and whether this turn should animate, return the portion to show right
// now. `enabled` is true only for the newest agent turn; every earlier turn passes false and renders
// in full immediately, so re-renders never replay an old reveal.
export function useTypewriter(text: string, enabled: boolean): string {
  const [count, setCount] = useState(() => (enabled ? 0 : text.length))
  const frameRef = useRef(0)

  useEffect(() => {
    if (!enabled || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setCount(text.length)
      return
    }

    let start: number | null = null
    const step = (now: number) => {
      if (start === null) start = now
      const progress = Math.min(1, (now - start) / REVEAL_MS)
      setCount(Math.round(progress * text.length))
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step)
      }
    }
    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [text, enabled])

  return text.slice(0, count)
}
