import { useEffect, useState } from 'react'

// Subscribe a component to a CSS media query so it can mount width-specific structure — and the
// data reads that structure triggers — only at the width that shows it. The app is a client-only
// SPA (no SSR), so the first value is read synchronously from `matchMedia` at mount, avoiding the
// mismatched-then-corrected flash a lazy read would cause. An environment without `matchMedia`
// (jsdom under the unit tests) resolves `false`, so a media-gated branch stays unmounted there.
//
// The assistant uses this to gate its desktop thread rail: the rail — and its `GET /threads` read —
// mounts only at `lg`, so a phone never fetches the conversation list until the reader opens the
// Sheet. That keeps the width split in JS rather than CSS, where a CSS-hidden-but-mounted rail would
// still fire the read on every screen open.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    // Sync once in case the query changed between the initial read and this effect.
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
