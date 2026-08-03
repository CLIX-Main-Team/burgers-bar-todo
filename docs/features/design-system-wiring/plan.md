# design-system-wiring — implementation plan

The implementation plan for wiring the Burgers Bar design system into apps/web. This is a rule-4
planning artifact; its spec (PRD input) is the design system under docs/design-system/, its build
ticket is GitHub issue #101, and its user-facing surface is ui-flow.md alongside this file. The
Engineering Design (docs/engineering-design.md) is the how of the wider app; this plan is the how
of this feature. It rests on the theming architecture decided in #68 and records no new ADR.

This plan is the what-and-in-what-order. It does not settle every file path; the steps below are
behavioural, matching how issue #101 and the design-system spec describe them. It follows the same
foundation-first shape the auth feature used: the shared layer lands first, and the surfaces adopt
it.

## What this delivers

A retheme of apps/web onto the decided tokens (principle 6: structure, behaviour, and
accessibility preserved; only styling repoints), plus one behavioural addition — a working
light/dark theme toggle. In four parts: the token foundation in index.css, the dark-mode
provider and toggle, the six-primitive retheme, and the surface sweep across the built auth,
people, and shell screens. The full scope, and what is out of it, is enumerated in issue #101.

## Build order

Foundation before adopters, so nothing is styled against tokens that do not yet exist.

1. Token foundation. Drop the three reference-CSS blocks from tokens.md into index.css: the colour
   system (Tier-1 --bb-* primitives, Tier-2 semantic light in :root and dark in .dark, the @theme
   inline bridge, the @custom-variant dark), then the layout tokens (spacing, radius from --radius,
   elevation softened under .dark, content-max, touch-min, control-height), then the typography
   tokens. Replace the current hardcoded body background and colour with the background/foreground
   tokens. Set color-scheme per theme.

2. Font. Add @fontsource-variable/assistant, load the Hebrew and Latin subsets with the @font-face
   rules, and confirm --bb-font-sans resolves to Assistant with the fallback stack behind it. This
   is the one new runtime dependency; it ships in the bundle (no CDN) for offline Capacitor use.

3. Dark-mode machinery. A ThemeProvider that stamps .dark on document.documentElement the way
   LocaleProvider stamps dir/lang, reading and persisting the choice in localStorage, defaulting to
   light, with no prefers-color-scheme detection. A small inline script in index.html applies the
   stored theme before first paint so there is no flash. This is the feature's only new behaviour.

4. Primitive retheme. Repoint the six primitives in components/ui — button, input, card, alert,
   field, select — from slate/red utilities onto the semantic tokens, per each primitive's retheme
   delta in components.md. Raise control height 40px to 48px, swap the slate focus ring for the ring
   token, and add button's secondary, ghost, and link variants. Structure and props are unchanged;
   only class strings move.

5. Surface sweep and the toggle. Repoint the residual hand-written utilities in the composed
   screens (the auth screens, auth-layout, language-toggle, password-field; the people screens; the
   shell — app-layout, tab-bar, account-menu; and the guards loading state). Add the theme toggle to
   account-menu beside the language toggle. Update the BottomNav active state to the accent-foreground
   label and gold primary dot.

6. Docs in the same change (rule 3). Update components.md: record the shell as a built-and-rethemed
   surface (it postdated the doc), and move the AvatarMenu theme toggle from planned to built here.

## The seams

The retheme touches presentation only, so the seams are the same ones the app already has; this
feature adds one.

- index.css is the token seam — the single place the whole system is defined, so a later compact
  density or a token tweak is one edit here, not a component sweep (tokens.md).
- The six ui/* primitives are the component seam the screens compose through; retheming them carries
  most of the visual change into the screens for free, which is why the surface sweep is thin.
- ThemeProvider is the one new seam: theme state is owned in one provider and expressed as a single
  class on the root, mirroring the existing LocaleProvider so the app has one shape for "a global
  preference stamped on <html>", not two.

## Testing approach

The gate is no-behaviour-change plus one new behaviour, matching issue #101's acceptance; the cases
are in test-cases.md.

- The existing auth and people tests and the Playwright smoke run unchanged and must pass without
  their expectations being edited to fit the retheme. An edit to a test's expectations is the signal
  that the retheme changed behaviour, which it must not.
- One new behaviour test covers the theme toggle: it stamps .dark, persists across a reload, and
  carries correct aria-pressed state.
- Token and accessibility conformance is confirmed visually against the mockup (both themes) rather
  than by a new snapshot harness — visual-regression infrastructure is out of scope for this
  feature at this scale.

## Review points (rule 5)

Not security-sensitive, no migrations, no architectural change (it executes #68's decided
architecture). The rule-5 pause here is the visual sign-off gate: human approval of the rethemed
surfaces in both themes before merge, per the standing directive to react to a mockup on any UI
change. The mockup is approved; the PR carries screenshots of the wired result for the same check.

## Risks

- Flash of wrong theme. Mitigated by the pre-paint inline read in index.html (step 3); called out
  because it is the one place a class-based theme visibly fails if wired late.
- Retheme drift into behaviour. Raising control heights and adding variants can nudge layout;
  mitigated by the unchanged-tests gate — if a height change breaks a test, that is the intended
  tripwire, resolved by adjusting the style, not the test.
- Font load. font-display: swap means a flash of the fallback stack on first load; accepted per
  tokens.md (the fallback is a close metric match). No blocking on the web font.
- Scope creep at the toggle. The toggle is the only new behaviour; the temptation is to also build
  the AvatarMenu Sheet re-anatomy or other components.md compositions. Those are out of scope
  (issue #101) and belong to their own feature builds on this foundation.
