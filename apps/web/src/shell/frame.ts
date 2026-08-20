// The content region's inner width, the shell's one readable column. Below `md` it is the
// phone-first 30rem cap; from `md` the shell widens it to --bb-content-wide and keeps it
// centred in the space beside the navigation rail.
//
// The caps are the --bb-content-* tokens, consumed directly as arbitrary values rather than
// through max-w-* utilities (tokens.md: content-max is used directly, not as a generated
// utility). This is also deliberate collision-avoidance: the design system's named spacing
// tokens (--spacing-lg etc.) share keys with Tailwind's container scale, so max-w-lg would
// now resolve to the 1.5rem spacing value, not 32rem.
//
// The wide cap is a working width, not a reading one (owner call 2026-08-16): at 70rem the
// roster, the branch table and the Knowledge shelves sat as a narrow column floating in the
// middle of a wide monitor while the board — the one screen that opted out — ran to the
// frame's edge, so no two pages looked related. At 100rem every screen fills the same space
// and starts at the same inset from the rail; the cap now only binds on very wide monitors,
// where it keeps a four-column table from stretching into unreadable rows. Screens still
// compose their own measures inside this frame — the chat caps its bubbles at a reading
// width regardless of how wide the surface gets.
export const CONTENT_INNER =
  'mx-auto w-full max-w-[var(--bb-content-max)] md:max-w-[var(--bb-content-wide)]'
