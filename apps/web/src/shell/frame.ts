// The shell's single readable content column. Header, content, and tab bar all cap
// their inner width to this and centre it, so the tabs line up under the content on a
// wide screen and everything shares one phone-first, max-width-capped column (PRD,
// stories 8/23). Kept as one constant so the readable width is changed in one place
// rather than edited across every shell surface.
//
// The cap is the --bb-content-max token (30rem), consumed directly as an arbitrary value
// rather than through a max-w-* utility (tokens.md: content-max is used directly, not as a
// generated utility). This is also deliberate collision-avoidance: the design system's
// named spacing tokens (--spacing-lg etc.) share keys with Tailwind's container scale, so
// max-w-lg would now resolve to the 1.5rem spacing value, not 32rem — the token is the
// honest, unambiguous source for the readable width.
export const CONTENT_COLUMN = 'mx-auto w-full max-w-[var(--bb-content-max)]'

// The content region's inner width. Below `md` it is the same phone-first 30rem column as
// the mobile chrome (CONTENT_COLUMN); from `md` the desktop shell widens it to
// --bb-content-wide and keeps it centred in the space beside the side nav.
//
// That cap is a working width, not a reading one (owner call 2026-08-16): at 70rem the
// roster, the branch table and the Knowledge shelves sat as a narrow column floating in the
// middle of a wide monitor while the board — the one screen that opted out — ran to the
// frame's edge, so no two pages looked related. At 100rem every screen fills the same space
// and starts at the same inset from the side nav; the cap now only binds on very wide
// monitors, where it keeps a four-column table from stretching into unreadable rows.
// Screens still compose their own measures inside this frame — the chat caps its bubbles at
// a reading width regardless of how wide the surface gets. Kept beside CONTENT_COLUMN so the
// two caps read together and change in one place.
export const CONTENT_INNER =
  'mx-auto w-full max-w-[var(--bb-content-max)] md:max-w-[var(--bb-content-wide)]'
