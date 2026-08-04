# Auth & onboarding screens — mockup · spec

The last fan-out screen of the mockup set (map #173, ticket #180): the four pre-authentication
screens — **login**, **reset-request**, **reset-consume**, and **invite-accept** — mocked as one
coherent set. They already share the **AuthLayout branded-split** (issue #123, map #116; the app's
branded front door), so this spec confirms that split holds at desktop and mobile and applies the
flagship's *interior* language — Field/Input/Button/Alert density and the empty/loading/error-state
discipline — to the forms within.

Read `docs/design-system/principles.md`, `tokens.md`, `components.md`, and `iconography.md` first,
and the flagship spec `../task-board/spec.md` second — this spec names their roles and never
restates their values. The companion `mockup.html` is the visual truth: it starts from a copy of the
shell's mockup harness (the same token CSS, embedded Assistant variable font, Phosphor `<symbol>`
sprite, and dir/theme toggle scaffold) and renders the four screens at **mobile and desktop**, in
**RTL (Hebrew, canonical) and LTR (English)**, in **light and dark**, across each screen's states.

## The composition decision — auth keeps its own frame, not the shell

Every in-app screen composes on the **desktop shell** (#175): a role-aware side nav, wide capped
content, the header absorbed into the nav. **Auth does not.** These four screens run *before*
authentication — there is no session, no role, no nav destination, and no content frame to compose
into. So auth keeps the **branded-split** it already has: a centered, rounded, bordered card holding
a **50/50 two-column split** — a gold `primary` brand panel beside the form column — that folds to a
gold **brand cap above the form** below the desktop breakpoint.

This is the one point where the #174 audit found auth *already good*: "auth already has a real
desktop split," unlike the marooned mobile columns of every in-app screen (X1–X3). So #180 is
**confirm-and-apply, not rebuild**: the split holds; what changes is that the forms within adopt the
flagship's field/button/alert density and its discipline of rendering every state as a first-class
thing. The branded-split is the auth analog of the flagship's kanban — the composition anchor the
rest of the spec is written against.

## Layout regions

The centered card (`--card`, `border`, `radius-xl`, `elevation-lg`, capped ~64rem) splits into two
columns at `md` and up; below `md` it is a single column (cap + form).

### Brand panel (desktop, inline-start)

The gold **`primary`** surface in **both** light and dark (gold is `primary` either way, and
ink-on-gold is the sanctioned pairing), so only the form column switches by theme. It holds, centered
and restrained (decision locked in #180 — no marketing copy): the **wordmark** ("Burgers Bar",
weight 800), a short hairline rule, and the **tagline**. Behind them sits the brand signature — the
client mark's **bracket-embrace** glyph (composed from the mark, ADR-0016) rendered large,
low-opacity (~15%), `aria-hidden`, and **flipped under RTL** so the embrace still reads as an
embrace. In the self-contained mockup the panel motif is approximated with a token-driven inline
shape; the build uses the real brand asset.

### Form column (inline-end / full width on mobile)

The `--card` surface, full height. Holds, top to bottom: a top-inline-end **language toggle** (the
`translate` glyph chip — the recipient's language choice on invite-accept *is* their saved
`preferred_language`, so the toggle is functional, not decoration); the screen **title**
(`heading-lg`, weight 600); an optional **description** (`--muted-foreground`); then the form, capped
~21rem and vertically centered. The single restrained entrance (`bb-rise-in`) is gated by
`prefers-reduced-motion`.

### Brand cap (mobile, above the form)

Below `md` the panel folds to a compact gold cap with rounded bottom corners: a smaller wordmark +
tagline over the same low-opacity motif, keeping the primary submit in the thumb zone.

## The four screens

Each renders its own form and states into the form column; the frame (panel/cap, title, language
toggle) is shared.

### Login (`login.tsx`)

- **Form** — email Input (`autocomplete=username`), password Input (`autocomplete=current-password`)
  **with the reveal toggle**, `primary` full-width submit, and a **"Forgot password?"** link to
  `/reset`.
- **States** — (1) *reset-done success*: a `success` Alert ("Your password was changed. Sign in with
  your new password.") shown when the router lands here from a completed reset; (2) *credential
  failure*: one **generic** `error` Alert ("Email or password is incorrect") with the **password
  field cleared** — a real email is never told apart from a fake one (non-enumerating); (3) *network
  failure*: an `error` Alert with the shared transport message; (4) *pending*: submit disabled,
  "Working…".

### Reset-request (`reset-request.tsx`)

- **Form** — email Input, `primary` submit, "Back to sign in" link.
- **States** — (1) *confirmation*: the screen always shows the **same non-enumerating** `success`
  Alert whether or not the address exists, is active, or is throttled ("If that email is registered,
  a reset link is on its way."), replacing the form, with a "Back to sign in" link — the request
  leaks nothing about which emails exist; (2) *network failure*: the **only** branch told apart (the
  request may not have reached the server), an `error` Alert; (3) *pending*.

### Invite-accept (`accept.tsx`)

- **Form** — a description ("Set a password to activate your account."), the shared **PasswordField**
  (label "New password", reveal toggle, hint "At least 8 characters"), `primary` submit ("Set
  password & continue"). Role and Location were baked into the invite and are immutable by the
  recipient (ADR-0005), so they are **not** shown as editable; the inviter-set display name is not
  rendered (no pre-accept invite-read endpoint exists — kept in step with `ui-flow.md`). Success sets
  the password, saves the toggle's language as `preferred_language`, activates the account, and signs
  the recipient straight in — no separate login.
- **Dead-end** (missing / expired / used token) — **no form**; a quiet `warning`/`error` Alert
  ("This invite link is no longer valid.") + a recovery line (**"Ask your manager to send you a new
  invite."**) + a **"Back to sign in"** link. *(Recovery path locked in #180 — the dead-end says what
  to do next, principle 4.)*
- **States** — *pending*; *bad-token* error Alert on a failed submit (token cleared, password reset).

### Reset-consume (`reset-consume.tsx`)

- **Form** — the shared **PasswordField** with reveal, `primary` submit ("Set new password"). Setting
  a new password succeeds and — as a consequence the user did not ask for — the API has **already
  revoked every one of their sessions**, so no session comes back and the user is sent to **login** to
  sign in afresh (login shows the reset-done banner above).
- **Dead-end** (missing / expired / used token) — a quiet `error` Alert ("This reset link is no
  longer valid.") + a **"Request a new link"** link to `/reset`. *(Recovery path locked in #180.)*
- **States** — *pending*; *network failure* Alert.

## The password reveal toggle (locked in #180)

The three password inputs — login password, invite-accept new-password, reset-consume new-password —
each carry an inline **eye / eye-slash** button at the inline-end of the field that toggles the input
between masked and plaintext. It cuts the mis-typed-password lockouts a fresh account or a reset is
most exposed to, and is the expected auth affordance.

**Build implication (flagged, not smuggled):** `eye` and `eye-slash` are in the `iconography.md`
registry conceptually but are **not yet in the shipped sprite** — the build adds the two glyphs. The
reveal control also belongs in the shared `PasswordField` (and login's password field) so the two
password-setting screens cannot drift, mirroring how `PasswordField` already centralizes the length
rule.

## Display states — the auth analog of empty/loading/error

The flagship set the discipline of rendering every data-state as a first-class thing. Auth has no
list to be empty, but it has its own state family the mockup renders explicitly, so the build treats
them as designed surfaces rather than afterthoughts:

- **Valid form** — the resting state, per screen above.
- **Dead-end link** — the invite/reset token is missing, expired, or used: a quiet Alert + a
  recovery path (locked #180), no form. The auth analog of "empty."
- **Confirmation without progression** — reset-request's non-enumerating acknowledgement and login's
  reset-done banner: success that intentionally does *not* advance the user, stated plainly.
- **Submit error** — credential / bad-token / network failures: soft `error` Alerts, password
  cleared, one generic non-enumerating message for credentials (principle 4: say what to do next, no
  apology, no leak).
- **Pending** — submit disabled, "Working…" — the auth analog of "loading."

## RTL / LTR

Every region uses **logical properties**, so the RTL-canonical layout is the source and LTR is the
automatic mirror: the brand panel sits at the **inline-start** in both directions (the right under
RTL), the language toggle at the inline-end, and the split folds to the same cap-above-form on
mobile regardless of direction. `LocaleProvider` already stamps `dir`/`lang` and the theme provider
stamps `.dark`, so the frame needs no direction- or theme-specific machinery. The brand motif is the
only directional ornament and is flipped under RTL. No directional icon is new to this surface.

## DS component & token mapping

| Region | Composes (`components.md`) | Key tokens / icons |
|---|---|---|
| Card frame | new composition (split card) | `card`, `border`, `radius-xl`, `elevation-lg`, `--bb-content` ~64rem |
| Brand panel / cap | new composition | `primary` / `primary-foreground` (both themes), low-opacity brand motif; `translate` (lang toggle) |
| Title / description | heading + supporting text | `heading-lg` (600), `muted-foreground` |
| Login / reset-request form | Field, Input, Button, Link | `input`, `--bb-control-height`, `primary`; `eye`/`eye-slash` (reveal) |
| PasswordField (accept, reset-consume) | Field (label + hint + error), Input, reveal Button | `input`, `muted-foreground` (hint), `destructive` (error); `eye`/`eye-slash` |
| Alerts (success / error / info) | Alert (soft tones) | `success-muted`, `destructive-muted`, `muted`; `warning` / `check-circle` / `x` glyphs |
| Language toggle | Button (ghost/icon) | `translate` |
| Submit | Button (`primary`, full-width, pending) | `primary`, `primary-foreground` |

## Icon roles used (registry, `iconography.md`)

`translate` (language), `eye` / `eye-slash` (**new to the sprite** — password reveal), `warning` and
`x` and `check-circle` (alert tones). The brand motif is the bracket-embrace mark (ADR-0016), not a
registry glyph. No status/nav glyphs — auth has no board and no nav.

## Breakpoint summary

| Width | Frame | Form |
|---|---|---|
| `< 768` (mobile) | gold brand **cap** above the form, single column | screen form, submit in the thumb zone |
| `≥ 768` (md+) | **50/50 branded split** — brand panel inline-start, form inline-end | form capped ~21rem, vertically centered |

There is no third (`lg`) shell for auth — unlike the in-app screens, the pre-auth card does not widen
into multi-column content. Two shells, not three.

## What this fixes / confirms from the #174 audit

- **Auth desktop split** — the audit found auth *already* has a real desktop split (the one in-app
  exception). #180 **confirms** it holds and does not maroon a mobile column, then raises the interior
  to the flagship's field/button/alert language. No X1–X3 fix is needed here (those were the in-app
  shell's job).
- **X5** (raw native controls) — auth's inputs are already DS Field/Input; the reveal toggle is the
  one net-new control, added as a DS-consistent affordance.
- **State discipline** — the audit's screenshots showed only happy paths; this spec renders the
  dead-end, confirmation, error, and pending states as designed surfaces.

## Build implications (flagged, not buried)

1. **Password reveal glyphs** — `eye` / `eye-slash` are new to the shipped sprite; the build adds
   them and puts the reveal control in the shared `PasswordField` (and login's password field).
2. **Dead-end recovery copy** — invite-accept's dead-end gains a recovery line ("Ask your manager to
   send you a new invite.") it does not have today (it currently shows a bare error). New i18n strings
   (he/en) for that line; reset-consume's "Request a new link" already exists.

## Notes

- Copy this set's parent harness (the shell's `mockup.html` `<head>` — token CSS, font `@font-face`,
  the Phosphor sprite, the device-frame + toggle scaffold) so auth renders as one system with the
  other screens.
- This screen adds two glyphs to the sprite — `eye`, `eye-slash` — the only additions; every other
  glyph it uses the shell/flagship already shipped.
- This is the **final** screen of map #173: with auth confirmed and applied, every v1 screen now has
  a committed mockup + spec, and the map's destination is reached.
