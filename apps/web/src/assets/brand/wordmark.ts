// The Burgers Bar wordmark, as on-token lockups. Two assets, one per ground, because the
// brand palette pairs the letterform with its surface rather than tinting one file two ways
// (design-system tokens.md, "The decisions"): the ink lockup is --bb-black (#000000) for a
// light surface, the cream lockup --bb-cream (#FEF3E3) for a dark or brand-gradient one, so
// no raw-white asset is ever placed on a light surface.
//
// The cream lockup is the one in use, and it fronts the pre-auth front door — cream on
// the warm-black board (auth round 2026-08-27), the brand book's own lockup pairing. The
// app shell sets its brand as the ( B ) mark plus live wordmark text, not an image, so
// neither lockup rides the (now neutral near-black) dark canvas.
//
// The letterform is the client's corporate wordmark, recoloured and composed only, never
// redrawn (ADR-0016). The source is the monochrome original at assets/brand/
// logo-wordmark-white.svg; these are its productionized, on-token derivatives, committed
// here in the app because this is where the Vite build consumes them.
//
// Both are pure-vector SVGs with no text or `dir` nodes, so they are direction-agnostic:
// rendered as an <img>, the wordmark never mirrors or reflows under RTL and reads
// identically in both directions. The header picks the lockup for the active theme (it
// already stamps `.dark` on <html>) and supplies the alt text.

// The light-theme lockup: black on cream. Render on the light `background`/`card`.
export { default as wordmarkLockupLight } from './logo-wordmark-ink.svg'

// The dark-theme lockup: brand cream. Render on the dark `background`/`card` or the
// brand-gradient panel.
export { default as wordmarkLockupDark } from './logo-wordmark-cream.svg'
