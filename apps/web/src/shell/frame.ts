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
// --bb-content-wide (70rem) and keeps it centred in the space beside the side nav, so
// ultrawide monitors don't stretch a screen edge to edge (shell spec #175, decision 3).
// Screens compose their own columns *inside* this frame. Kept beside CONTENT_COLUMN so the
// two caps read together and change in one place.
export const CONTENT_INNER =
  'mx-auto w-full max-w-[var(--bb-content-max)] md:max-w-[var(--bb-content-wide)]'
