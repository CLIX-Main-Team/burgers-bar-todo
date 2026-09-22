// The two surfaces the house style is built from (Dashboard round 3, 2026-09-22; shared with the
// Tasks page from its own redesign the same week). The owner pointed at his coworkers' dashboards
// as the house style: big soft cards on the grey canvas, and tiles sunk into a card. Written once
// here so the pages that use them cannot drift apart.

// A card's corner is a size up from the rest of the app's 10-12px panels on purpose: these are
// the largest surfaces the app draws, and the reference screens round them at about 20px.
export const CARD_SURFACE = 'rounded-[1.25rem] border border-border bg-card shadow-sm'

// A tile inside a card. It sinks rather than lifts, so a card full of tiles reads as one surface
// holding several things and not as cards stacked on cards.
export const TILE_SURFACE = 'rounded-[0.875rem] bg-surface-sunken'
