# Assistant — flagship mockup · spec

The **hero surface** of the flagship-redesign map ([#244](https://github.com/IamIsthill/burgers-bar-todo/issues/244)),
foundation ticket [#246](https://github.com/IamIsthill/burgers-bar-todo/issues/246): the grounded
ops-assistant chat rebuilt to **establish the cross-cutting flagship visual language** every other
surface inherits. It applies the reference sweep ([#245](https://github.com/IamIsthill/burgers-bar-todo/issues/245))
over our locked tokens.

**Supersede call (locked, #246): this mockup SUPERSEDES the current assistant design direction**
([`../assistant/`](../assistant/), #178). #178 was a strong, DS-faithful baseline; its structural
calls survive here (asymmetric no-bubble thread, book measure, desktop rail-in-frame,
refusal-as-answer). This mockup keeps all of that and adds the four signature moments that make the
surface read **flagship, not merely competent**. The downstream build works toward *this*.

Read [`../flagship-language.md`](../flagship-language.md) first — this spec is the concrete proof of
that language; it names the four laws (chrome recedes · borders-first · one gold beat · motion=state)
and does not restate them. Read `../../principles.md`, `../../tokens.md`, `../../components.md`
(§Assistant), and `../../iconography.md` for the values this composes; and the #178 spec
(`../assistant/spec.md`) as the inherited baseline. The companion `mockup.html` is the visual truth:
it reuses the shell's harness (token CSS, embedded Assistant font, Phosphor sprite) and renders the
**desktop hero** plus a **signature-moments strip**, with live **dir (RTL/LTR)** and **theme
(light/dark)** toggles.

## What this mockup renders

- **Frame 1 — Desktop hero (1440px, Hebrew/RTL canonical).** The full flagship composition inside
  the shell: receding side nav, thread rail, a book-measure conversation, and the answer-as-artifact
  companion plane, ending in the signature Composer. One realistic ops conversation exercises all
  four signature moments at once.
- **Frame 2 — Signature moments strip.** Each moment/state isolated at readable size: the working
  disclosure open **and** collapsed, the result plane mid progressive-fill, the layered-source
  popover open, the grounded refusal, the error/try-again, and the context-seeded first-run.

## The four signature moments (what this ticket adds over #178)

Priority order from the sweep; all recomposed in our tokens, RTL-first, reduced-motion-safe.

### 1. The narrated, self-collapsing "working" disclosure
Replaces #178's bare three-dot pending indicator. While the single grounding call runs (ADR-0003,
one synchronous answer), the assistant shows **honest micro-steps** in a quiet `muted` disclosure —
"opened your board", "read shift tasks", "filtering overdue…" — each step led by a spinner while
active and a `success` check when done. When the answer lands it **collapses to a one-line trace**
("worked on the answer · checked your board / 2 procedures") that stays **expandable**. For a
*grounded* assistant this is the trust story: it shows the answer came from the docs/board. The steps
are a **small, known set** (ADR-0003), not an open-ended agent trace. Under
`prefers-reduced-motion` the spinner freezes and the collapse is instant. `role="status"`.
_(Component: `.working` open, `.work-trace` collapsed.)_

### 2. Answer-as-artifact — the lifted companion result plane
The surface's true signature moment and the reason desktop has spare width. When an answer is a
**structured result** — "who's on the grill today?" → a roster; "what's overdue?" → a task list —
it does **not** render as inline Markdown. A thin conversational lead-in stays in the thread with a
small **lift-note** chip ("grill shift · 3 people"), and the result **lifts into the one raised
companion plane** at the inline-end of the workspace, reusing the board's card / avatar / badge
primitives. The plane is the app's **one deeper layer**: border + a warm tint step, **no drop
shadow**. It **fills progressively** (skeleton avatar+rows → resolved rows) so the wait is
productive, and carries a live-source footer ("live from the task board · updated now").
**Locked as a core signature, drawn-and-flagged (#246)** — see *Build implications*.
_(Component: `.artifact` / `.artifact-plane`, `.is-filling` variant, `.lift-note`.)_

### 3. Layered source affordance
Deepens #178's flat attribution row into three layers (Perplexity's move, retuned neutral/no-blue):
a **summary** chip beneath the answer ("grounded in 2 procedures", expandable), an **inline cite
chip anchored to the sentence it justifies** (`.icite`, `file-text` glyph), and a **hover/tap
popover** previewing the doc title + snippet + "source 1 of 2". Every chip and filename is
`bidi-isolate`d (`<bdi>`) so Latin doc names sit correctly inside Hebrew. The popover is a **true
overlay** — the one place a shadow (`--bb-elevation-lg`) is allowed. Strengthens (does not replace)
the existing "needs a backend `sources` field" flag.
_(Components: `.cite-sum`, `.cite-anchor`/`.icite`/`.cite-pop`.)_

### 4. The Composer as the signature control + context-seeded prompts
The Composer is sharpened into the app's signature control: **one big field, one gold `Send`**, a
single quiet leading `+` (everything else collapsed), **no resting shadow** (borders-first). Above
it, **context-seeded prompt chips scoped to the real board & procedures** ("who's on tonight?",
"what's overdue for me?", "kitchen-closing procedure") — the reusable-shortcut move, not generic
suggestions. Send's `paper-plane-tilt` is directional (flips in RTL); disabled-while-empty renders
as the resting `muted` state. _(Components: `.composer--flag`, `.composer-lead`, `.pchips`/`.pchip`.)_

## The one gold beat (ratified tightening, #246)
#178 spent gold on **both** Send and New-conversation. The flagship language locks **one gold beat
per surface**, so **New-conversation is demoted to a quiet `outline` control** and **Send is the
surface's single gold action**. The gold brand-mark and the active-nav marker are
identity/orientation, not actions, and don't count. This tightening is now an app-wide rule
(`../flagship-language.md`, Law 1).

## Layout (inherited from #178, extended for the plane)
The assistant renders into the shell's content frame. Breakpoint behaviour is unchanged from #178
(mobile in-content header + bottom Sheet; `md` content-header + Sheet; `lg` persistent thread rail
in-frame). **The one extension:** at `lg`, when a structured result is present, the workspace grid
becomes **three columns** — thread rail (`--bb-sidenav`) · book-measure conversation (~42rem) ·
companion result plane (`minmax(20rem,1fr)`) — and the content cap widens to hold them. This is
Law 1 made literal: *width buys a panel, not wider text*. Without a lifted result, the conversation
centres as before. The reading measure never exceeds ~42rem regardless.

## RTL / LTR, light / dark
Built RTL-canonical with logical properties only, so LTR is the automatic mirror: side nav and
thread rail at the inline-start, user bubble at the inline-end, assistant text + companion plane
follow suit, the source popover and Sheet stay correctly anchored in both directions. The only
directional glyph is **Send**. Dark mode grounds on the warm near-black tokens (not an inversion):
the plane and rail layer by **tint** rather than hairline, gold `Send` and the active-nav marker are
the only warm accents. Verified in all four combinations.

## DS component & token mapping (flagship additions)

| Region | Composes | Key tokens / icons |
|---|---|---|
| Working disclosure | `.working` (open) / `.work-trace` (collapsed) | `muted` ground, `--border`, `success` (done); `check-circle`, `caret-down`; spinner reduced-motion-safe |
| Answer-as-artifact plane | `.artifact-plane` + board card/avatar/badge primitives | `card` + one tint step + hairline (no shadow), `radius-xl`; `users`, `dots-three`, `info`; `.lift-note` on `accent` |
| Layered sources | `.cite-sum`, `.icite`, `.cite-pop` | `muted` chips + `--border`; popover = `popover` + `--bb-elevation-lg` (true overlay); `file-text`; all `bidi-isolate` |
| Signature Composer | `.composer--flag`, `.composer-lead`, `.pchips` | `card`/`input`, `radius-xl`, **`primary` Send only**; `plus` (lead), `paper-plane-tilt` (directional) |
| Chrome recede | `.app--flag` nav treatment | nav labels `muted-foreground`, nav surface `--background`, active `accent` |

## Build implications (flag, not smuggle)
Two dependencies the downstream `/to-spec` + build must own (draw-it-and-flag, per #178's pattern):

1. **Answer-as-artifact needs a structured result payload.** The mockup lifts a roster/task-list out
   of the stream; the shipped answer path returns Markdown prose only. Rendering the plane requires
   the answer to carry a **structured board/roster result** (not just text). Locked as a core
   signature to build toward (#246), not a shipped capability.
2. **Layered sources need a backend `sources` field** and a reversal of the no-cite system-prompt
   line (`grounding.ts`) — inherited from #178's flag, now deepened to three layers.

Everything else (streaming reveal, progressive fill, keyboard drive, the collapse behaviours) is
client behaviour described here and owned by the build.

## Provenance
Foundation ticket #246 of map #244; reference sweep #245
(`../references/assistant-flagship-refs.md`); supersedes assistant mockup #178 (`../assistant/`).
Establishes `../flagship-language.md`, which the task-board, app-shell, people, and state surfaces
inherit.
