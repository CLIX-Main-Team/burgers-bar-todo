// The Burgers Bar assistant mark, as on-token tiles for the assistant surface (#93) to
// render beside the agent's turns. Two assets, one per theme, because the mark is laid up
// on the `accent` surface and the brand palette pairs a surface with its own foreground
// rather than tinting one file two ways (design-system tokens.md, "The decisions"): the
// light tile is the pale-blue accent canvas with the mark in the deep interaction blue,
// the dark tile is the deep-blue accent canvas with the mark in light blue. Each uses that
// theme's `accent` / `accent-foreground` pair exactly — surface --bb-blue-100 (#EAF2FC)
// with mark --bb-blue-600 (#1E64B6) light, surface --bb-blue-950 (#16293F) with mark
// --bb-blue-300 (#7FB0EE) dark — so no raw-white asset is ever placed on a light surface
// and the mark reads as the assistant's accent identity in both themes.
//
// The glyph is the client's corporate mark, composed onto the accent tile and recoloured
// only, never redrawn (ADR-0016). The bracket-and-B geometry is lifted verbatim from the
// monochrome source at assets/brand/icon-mark-white.svg — the same geometry the app/PWA
// icon and favicon compose — and only its fill and surface change here. These are its
// productionized, on-token derivatives, committed in the app because this is where the
// Vite build consumes them.
//
// Both are pure-vector SVGs with no text or `dir` nodes, so they are direction-agnostic:
// rendered as an <img>, the mark never mirrors or reflows under RTL and reads identically
// in both directions. The tile is a rounded square (rx ~19% of the side); a consumer
// wanting a circular avatar clips it with CSS. The surface picks the tile for the
// active theme (the app already stamps `.dark` on <html>) and supplies the alt text.

// The light-theme tile: deep-blue mark on the pale-blue accent surface. Render on the light theme.
export { default as assistantMarkLight } from './assistant-mark-light.svg'

// The dark-theme tile: light-blue mark on the deep-blue accent surface. Render on the dark theme.
export { default as assistantMarkDark } from './assistant-mark-dark.svg'
