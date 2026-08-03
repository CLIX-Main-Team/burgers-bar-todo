// The bracket-embrace brand signature for the pre-auth frame (issue #123): the client
// mark's own two brackets, enlarged tone-on-tone to embrace the wordmark — the mark using
// its own gesture at hero scale. It is composed only from the two bracket paths of
// assets/brand/icon-mark-white.svg (ADR-0016: compose, don't redraw — the B is dropped and
// no new artwork is drawn), the same geometry the app/PWA icon and assistant mark reuse.
//
// It is filled with the ink `primary-foreground` token exactly (--bb-ink-max #23180a).
// The pre-auth brand panel and mobile cap are the gold `primary` surface in both light and
// dark — gold is `primary` either way — so the ink fill is constant and one asset serves
// both themes, unlike the theme-paired wordmark and assistant-mark lockups. It is rendered
// large, low-opacity, and `aria-hidden` behind the panel/cap content: pure decoration.
//
// A pure-vector SVG with no text or `dir` nodes, so as an <img> it never reflows; the frame
// flips its orientation under RTL with a logical transform so the embrace still reads as an
// embrace. Committed here in the app because this is where the Vite build consumes it,
// following the wordmark.ts / assistant-mark.ts precedent.
export { default as bracketEmbrace } from './bracket-embrace.svg'
