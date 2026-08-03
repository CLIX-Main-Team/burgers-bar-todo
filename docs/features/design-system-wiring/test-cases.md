# design-system-wiring — test cases

The test cases for the design-system wiring feature, derived from the acceptance in GitHub issue
#101. This is the third rule-4 planning artifact, alongside ui-flow.md and plan.md; it rests on the
theming architecture decided in #68. It enumerates what must be proven; the how of the harness is in
plan.md and issue #101.

Each case names the behaviour, the way it is asserted, and what it traces to. Cases carry a stable
id (TC-DSW-nn) so the pull request and any later regression can cite them. Because this is a retheme
(principle 6), most of the assurance is negative — proving behaviour did not change — with one
positive area for the new theme toggle and one for token conformance.

## How these are exercised

Three kinds of check, matching the acceptance gate. First, the existing automated suites run
unchanged: the auth and people tests through the Fastify HTTP seam (docs/features/auth/test-cases.md)
and the Playwright smoke. Their expectations are not edited to fit the retheme — an edit is itself
the signal that behaviour changed. Second, one new automated behaviour test for the theme toggle.
Third, a visual conformance check against the approved mockup in both themes, for the styling the
automated suites do not see.

## Behaviour unchanged

- TC-DSW-01 — The full auth test suite passes with no edits to its expectations after the retheme.
  Asserted by running the suite green on the feature branch and confirming the diff touches no
  assertion in docs/features/auth/test-cases.md's cases. Traces to issue #101 acceptance
  (behaviour unchanged).
- TC-DSW-02 — The people-management tests pass with no edits to their expectations. Asserted the
  same way. Traces to #101 (behaviour unchanged).
- TC-DSW-03 — The Playwright smoke passes unchanged: the app boots, the login screen renders, and a
  sign-in reaches the shell. Asserted by the smoke run green. Traces to #101 (behaviour unchanged).
- TC-DSW-04 — Control-height and variant changes do not break interaction. Any test that would fail
  because a control grew from 40px to 48px or because a button variant changed is treated as a real
  regression and fixed in the styling, never by relaxing the test. Asserted by the suites above
  staying green without expectation edits. Traces to #101 (retheme risk, behaviour unchanged).

## The theme toggle

- TC-DSW-05 — Default light on first load. With no stored preference, the app renders in light
  theme and .dark is absent from the document root. Asserted through the ThemeProvider seam / the
  rendered root class. Traces to #101 (theme toggle) and ui-flow.md step 1.
- TC-DSW-06 — Toggling to dark stamps the theme. Operating the toggle's Dark option adds .dark to
  document.documentElement and sets the pressed state to Dark, with no navigation. Traces to #101
  and ui-flow.md step 2.
- TC-DSW-07 — The choice persists across reload. After choosing dark and reloading, the app opens
  in dark with .dark present and Dark pressed, read from localStorage. Traces to #101 and
  ui-flow.md step 3.
- TC-DSW-08 — aria-pressed reflects the current theme. Exactly one of the two options carries
  aria-pressed=true, matching the showing theme, in both the initial and toggled states. Traces to
  #101 (accessibility) and ui-flow.md accessibility.
- TC-DSW-09 — No auto-detect. With the OS set to dark and no stored preference, the app still opens
  in light (the class-based-explicit decision, #68). Asserted by the initial root class with a
  dark prefers-color-scheme. Traces to #101 and ui-flow.md (what it does not do).

## Token and accessibility conformance

Confirmed visually against the approved mockup and the tokens.md reference CSS, in both themes;
no new snapshot harness (out of scope, plan.md).

- TC-DSW-10 — index.css carries the token layer. The three reference-CSS blocks (colour, layout,
  typography) are present: Tier-1 --bb-* primitives, Tier-2 semantic tokens with light in :root and
  dark in .dark, and the @theme inline bridge. Asserted by inspection of index.css against
  tokens.md. Traces to #101 (token foundation).
- TC-DSW-11 — No hardcoded slate or red remains in the rethemed surfaces. The six primitives and
  the swept screens carry no bg-slate-*, text-slate-*, border-slate-*, or text-red-* utilities; they
  paint through the semantic tokens. The out-of-scope placeholder screens are excluded. Asserted by
  a grep over the rethemed files. Traces to #101 (primitive retheme, surface sweep).
- TC-DSW-12 — The gold primary is spent once per screen. On login the only gold fill is the submit
  button (the language and theme toggles use the soft accent surface for their selected option, not
  the primary). Asserted visually against the mockup. Traces to #101 and principle 3.
- TC-DSW-13 — Both themes are legible and focus is visible. Foreground on canvas, muted-foreground,
  and the status pairings read at the tokens.md ratios, and every interactive element shows the ring
  token on focus-visible, in light and dark. Asserted visually against the mockup and by keyboard
  focus check. Traces to #101 (accessibility) and tokens.md conformance.
- TC-DSW-14 — Assistant font loads and applies. With the font present, body and headings render in
  Assistant; with it blocked, they fall back to the stack with no layout break (font-display: swap).
  Asserted visually. Traces to #101 (font) and tokens.md typography.

## Not covered here

Structure, routing, and API behaviour are unchanged by this feature and are covered by the existing
suites; they are not re-enumerated. The unbuilt components.md compositions and the placeholder
screens are out of scope (issue #101) and carry no cases here.
