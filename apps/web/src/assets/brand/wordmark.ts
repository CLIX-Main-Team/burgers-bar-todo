// The Burgers Bar header wordmark, as on-token lockups for the shell header (#80) to
// render. Two assets, one per theme, because the brand palette pairs the letterform with
// its surface rather than tinting one file two ways (design-system tokens.md, "The
// decisions"): the light lockup is warm ink on the cream canvas, the dark lockup warm
// cream on the ink canvas. Each is filled with that theme's `foreground` token exactly —
// --bb-ink-850 (#211A11) light, --bb-cream-100 (#F1E7D5) dark — so the wordmark reads as
// foreground text in the header and no raw-white asset is ever placed on a light surface.
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

// The light-theme lockup: warm ink on cream. Render on the light `background`/`card`.
export { default as wordmarkLockupLight } from './logo-wordmark-ink.svg'

// The dark-theme lockup: warm cream on ink. Render on the dark `background`/`card`.
export { default as wordmarkLockupDark } from './logo-wordmark-cream.svg'
