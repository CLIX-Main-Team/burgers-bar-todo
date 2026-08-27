// The bracket-embrace brand signature for the pre-auth frame (issue #123): the client
// mark's own two brackets, enlarged tone-on-tone to embrace the wordmark — the mark using
// its own gesture at hero scale. It is composed only from the two bracket paths of
// assets/brand/icon-mark-white.svg (ADR-0016: compose, don't redraw — the B is dropped and
// no new artwork is drawn), the same geometry the app/PWA icon and assistant mark reuse.
//
// It is filled with the brand cream exactly (--bb-cream #FEF3E3), though since the auth
// round of 2026-08-27 the frame consumes it as a CSS mask (index.css .bb-embrace): the
// vector is the shape and the --bb-gradient-brand sweep is the ink, so one asset serves
// both themes whatever it is painted with. It is rendered at architectural scale around
// the sign-in card and `aria-hidden`: pure decoration.
//
// A pure-vector SVG with no text or `dir` nodes, and the embrace is left-right symmetric,
// so RTL and LTR are the same picture with no flip. Committed here in the app because this
// is where the Vite build consumes it, following the wordmark.ts / assistant-mark.ts
// precedent.
export { default as bracketEmbrace } from './bracket-embrace.svg'
