# The flagship visual language

The cross-cutting design language for the Burgers Bar staff app, **locked on the hero assistant
surface** ([`assistant-flagship/`](./assistant-flagship/)) and written so a session working **any
other surface** can apply it without re-deciding. Produced by the foundation ticket
[#246](https://github.com/IamIsthill/burgers-bar-todo/issues/246) of the flagship-redesign map
[#244](https://github.com/IamIsthill/burgers-bar-todo/issues/244), from the reference sweep
[#245](https://github.com/IamIsthill/burgers-bar-todo/issues/245).

It is a **retheme, not a redesign of the design system.** Every rule below is expressed in the
existing tokens (`../tokens.md`) — gold-leads warm palette, no blue, WCAG-2.2-AA, three-tier tokens,
Hebrew-first / RTL. **Token changes are out of scope.** We steal *composition and interaction* from
best-in-class products and recompose them in our brand; we never take their colour or density.

## The governing sentence

> **Chrome recedes, work advances. Separate with border and warm tint, not shadow. Spend the one
> gold beat only where the eye must go. Motion communicates state, never decorates.**

Read every screen against that sentence. The four laws below make it operable.

## Law 1 — Density: calm, reading-first, one focal act

- **One primary action per surface, one gold beat.** Gold (`--primary`) is spent on exactly **one**
  action per screen — the single thing the eye must land on. On the assistant that is **Send**;
  New-conversation and every other secondary action go **quiet** (`outline` / ghost), *not* gold.
  This is a locked, ratified rule (#246): if a second gold button appears on a surface, one of them
  is wrong. (The gold brand-mark and the active-nav marker are **identity/orientation**, not
  actions, and don't count against the beat.)
- **Reading measure stays narrow; width buys a companion panel, not wider text.** Reading-heavy
  columns cap at a book measure (~42rem on the assistant). Surplus desktop width is spent on a
  **lifted companion plane** (Law 3), never on stretching a line of text past comfort.
- **Chrome recedes.** Orientation UI — the side nav, thread rails, filter chrome — sits a notch
  quieter than the work: resting nav labels use `--muted-foreground`, the nav surface drops to
  `--background`, active state alone earns `--accent`. The work area holds the contrast.

## Law 2 — Depth / elevation: borders-first, warm, flat page

- **Separate with border + a warm surface tint, never a drop shadow.** This is already the token
  law; the flagship makes it strict and app-wide. Cards, rails, and result planes lift by **one
  tint step + a hairline** (`--card`/`--muted` on `--background`, `1px --border`).
- **Shadows are reserved for true overlays only** — the DS `Sheet`, popovers (e.g. the source-
  preview), toasts, the mobile drawer. `--bb-elevation-*` never appears on a resting in-page card.
- **One companion-panel plane.** When a surface lifts structured output out of a stream/flow, it
  lifts to **a single raised plane** — the app's one "deeper" layer — used consistently, tint in
  dark and hairline in light.

## Law 3 — Motion: purposeful, calm, reduced-motion-safe

- **Motion only communicates state**, never decorates. The whole budget: streaming reveal,
  progressive result fill (skeleton→rows), pending→answer transition, Sheet/thread transitions.
- **Stream the answer *and* the result.** Text may reveal progressively; a lifted structured result
  **fills progressively** (skeleton rows resolve) so the wait is productive, not a dead spinner.
- **Every motion has a `prefers-reduced-motion` off-ramp** that degrades to an instant, honest
  state. Spinners freeze, reveals become immediate, collapses happen without animation.

## Law 4 — Signature moments: what reads flagship, not merely competent

These are the reusable "moves." A surface adopts the ones that fit; it doesn't invent competing
ones. Each is proven concretely in the assistant mockup.

1. **The narrated, self-collapsing "working" disclosure.** Replace bare pending indicators with
   **honest micro-steps** while work runs ("opened your board", "read shift tasks", "filtering
   overdue…"), then **collapse to a one-line trace** when the result lands (expandable on demand).
   For grounded/derived output this doubles as the trust story — it *shows* where the answer came
   from. (Component: `.working` / `.work-trace`.)
2. **Answer-as-artifact — lift structured output out of the flow into the companion plane.** When
   output is a **structured result** (a roster, a task list, a table), don't render it as a wall of
   inline text — **lift it into the one raised companion plane** beside the reading measure, reusing
   board/people primitives (cards, avatars, badges, StatusControl). Fills progressively. **Locked as
   a core signature (#246), drawn-and-flagged**: it depends on the surface exposing a structured
   result payload (see *Build dependencies* below). (Component: `.artifact` / `.artifact-plane`.)
3. **Layered source / provenance affordance.** Where output is grounded, layer the sourcing:
   a **summary** ("grounded in N …") → an **inline chip anchored to the item it justifies** → a
   **hover/tap preview** of the source snippet. Neutral/muted, **never blue**, every chip
   bidi-isolated so a Latin filename sits correctly inside Hebrew. (Components: `.cite-sum`,
   `.icite`, `.cite-pop`.)
4. **The primary input as the surface's signature control.** The one field the user acts through
   (the Composer here; the create/edit control elsewhere) is **one big field, one gold action,
   everything else a quiet affordance** — instant-feeling, optimistic, keyboard-drivable on desktop.
5. **Context-seeded, reusable shortcuts.** First-run and pinned chips are **scoped to the user's
   real data** (their board, their procedures, their location), not generic — a low-cost, high
   "made-for-us" signal.

## Applying this to a new surface (the propagation checklist)

A surface session inherits this doc and produces a flagship mockup + a supersede/keep call. Work
the checklist:

1. **Find the one gold beat.** Name the single primary action; demote everything else to quiet.
2. **Cap the reading measure; spend surplus width on a plane, not wider text.**
3. **Recede the chrome** one notch below the work.
4. **Re-verify elevation is borders-first**; move any resting shadow onto a true overlay or delete it.
5. **Adopt the signature moments that fit** the surface (not all five apply everywhere); reuse the
   assistant's components rather than inventing parallels.
6. **Prove it RTL-canonical** with logical properties, then confirm the LTR mirror and light+dark.
7. **Handle the state family** — first-load / loading (skeleton) / empty / error / transition — in
   the language (this is its own cross-cutting surface; see map #244).
8. **Record a supersede/keep call** vs the current design direction, linking the mockup asset.

## Build dependencies (flag, don't smuggle)

The language draws two things the shipped app cannot yet render; surfaces adopting them must flag
the dependency the way #178 flagged attribution, not pretend it exists:

- **Answer-as-artifact** needs the surface to expose a **structured result payload** (e.g. the
  assistant answer carrying a board/roster result, not just Markdown prose). Drawn-and-flagged; the
  build spec owns adding it.
- **Layered sources** needs a **`sources`/provenance field** on the grounded output (the assistant's
  answer path deliberately emits none today; the system prompt must be reversed). Same
  draw-it-and-flag posture as #178.

## Provenance

- Reference sweep + the one-thing-to-steal per product:
  [`references/assistant-flagship-refs.md`](../references/assistant-flagship-refs.md) (#245).
- The proof surface (this language made concrete): [`assistant-flagship/`](./assistant-flagship/)
  (`mockup.html` + `spec.md`, #246). It **supersedes** the prior assistant direction ([`assistant/`](./assistant/), #178).
