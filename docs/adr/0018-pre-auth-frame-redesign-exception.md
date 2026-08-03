# The pre-auth frame is a sanctioned exception to retheme-don't-redesign

Status: accepted. Decided while resolving the pre-auth-frame redesign map (#116), closing its
record ticket #119. Not security-sensitive. Carves a bounded exception to design principle #6
("retheme, don't redesign") and records the accepted design so the exception is not silently
"fixed" back to a plain card later.

## Context

Principle #6 governs the whole design system: it is a token and guideline layer over the inherited
shadcn/ui and Tailwind components, and components are restyled through tokens, never rebuilt —
structure, behaviour, and accessibility affordances preserved. Nothing bespoke is invented. That
rule is right for the app's interior, where dozens of surfaces share the same primitives and a
retheme keeps them coherent and cheap.

The shared pre-auth frame is where the rule strains. `AuthLayout`
(`apps/web/src/components/auth-layout.tsx`) wraps the four pre-auth screens — login, accept-invite,
reset-request, and reset-consume — and inherited from Clix-CRM a mobile-first centred card: a ~24rem
single column, vertically centred on a cream ground. On a phone that card is roughly 80% right. On
desktop it reads as "so AI" — a narrow card marooned in a wide empty void, the tell of a mobile
layout stretched to a monitor with nothing designed to fill the space. Map #116 diagnosed the
problem as largely a *desktop layout* problem, not a colour one, which is exactly what a token
repoint cannot fix.

The front door is also a uniquely high-leverage surface. It is the first branded impression, seen
before a user authenticates; and it is the one place with no in-app chrome — no nav, no board, no
assistant — to carry identity on its behalf. Everywhere else the interior furniture does the
branding work; here the frame itself must. Map #116 charted the redesign across research #117 (brand
asset inventory) and prototype #118 (the signed-off design), and concluded this one surface earns a
redesign rather than a retheme.

## Decision

Carve the shared `AuthLayout` as a **sanctioned exception to principle #6**. At this frame — and
only this frame — the design may be *redesigned*, not merely rethemed: it gets a desktop split with
a composed illustrative brand panel, a structural move principle #6 otherwise forbids.

**The exception is scoped tightly to the frame, not the form.** It covers the shared `AuthLayout`
that wraps the four pre-auth screens. The screens' *contents* — the Field-wrapped Inputs, the
`PasswordField`, the `LanguageToggle`, the primary submit — remain rethemed shadcn primitives under
principle #6, unchanged by this ADR. What is redesigned is the frame those forms sit in. The
exception does **not** extend to any authenticated surface — the task board, the assistant, the app
shell, the people-management screens all stay pure retheme under #6.

The accepted design, from prototype #118 (signed off):

- **Desktop 50/50 split.** A gold brand panel on the inline-start, the form on the inline-end. The
  split unfolds only at the desktop breakpoint and mirrors via logical properties alone, so RTL
  (the canonical direction, principle #2) is the automatic home and LTR its mirror — no
  direction-specific machinery.
- **Panel signature — treatment A, "bracket embrace."** The mark's two brackets, blown up
  tone-on-tone, frame the wordmark at the panel's centre. The panel is composed entirely from the
  existing brand geometry in `assets/brand/` (the `[B]` mark, the isolated brackets glyph, and the
  wordmark lockups shipped by #107) per ADR-0016 — it commissions no new illustration. The gold
  field is constant in both themes (gold *is* `--primary`), carrying a subtle gradient and a soft
  warmth glow.
- **Form on a crisp canvas, no card.** The modern-professional direction: the form sits directly on
  a clean surface (white in light, deep ink in dark) rather than inside a raised Card, with sharper
  type and a focus-halo on inputs.
- **Tagline slot,** carrying the warm-plain-respectful voice (principle #4), voiced natively per
  language rather than translated literally: **"המשמרת מתחילה כאן." / "Your shift starts here."** —
  a front-door line that reads as arrival at the start of the shift.
- **Mobile.** The split does not appear on a phone. The panel collapses to a gold brand cap above a
  stacked form, with the primary action in the lower thumb arc (principle #1). The mobile uplift is
  the brand cap plus warmth; the desktop split is the marquee move.
- **Accessibility, both themes.** Ink on gold is `--primary-foreground` on `--primary` at 8.7:1,
  clearing AA and AAA; focus is always visibly indicated; non-essential motion (the panel's rise-in,
  the glow) respects `prefers-reduced-motion` (principle #5). Light and dark are both specified.

This composes on top of ADR-0016 (brand identity is composed from the client's mark, not redrawn):
the panel is an arrangement of geometry we already hold, and the #107 asset set is its raw material.

## Considered options

**Obeying principle #6 as written — a pure retheme of the existing card** (repoint the ground and
panel at the `background` and `card` tokens, keep the centred single column) was the default and was
rejected. It is precisely the move that leaves the "so AI" desktop void intact: #116's diagnosis is
that the problem is layout, and a token repoint changes colour without changing the marooned-card
geometry. The retheme is correct for the app's interior and stays in force there; the front door is
where it visibly falls short.

**Reopening principle #6 for the whole app — "more visual identity everywhere"** was rejected and
ruled out of scope for this effort. It is a far larger change, closer to a one-way door once staff
associate a richer look with every surface, and unjustified by the problem in hand. The front door
is a uniquely high-leverage, low-risk surface — first impression, no in-app data, no interior chrome
to keep coherent — and generalising from it to the interior does not follow. A broader visual-identity
pass, if ever wanted, is a separate future effort, not a consequence of this one.

**Commissioning new hero artwork for the panel** was rejected as a violation of ADR-0016. Research
#117 confirmed every raw material for the panel already exists on disk — the mark paths, the isolated
brackets glyph, both wordmark lockups, the full token palette — so a composed panel needs no new
client art, and inventing illustration is the one place agent output risks looking generic and
overstepping the client's identity.

## Consequences

Principle #6 in `docs/design-system/principles.md` gains a short pointer to this ADR, so the next
implementer reading the retheme rule discovers the sanctioned exception where they will look for it.
The exception's reasoning and boundary live here, in the ADR, not inlined into the principle.

The Auth section of `docs/design-system/components.md` is re-specced. The `AuthLayout` entry, which
had carried a one-line retheme delta ("repoint its ground and panel at `background` and `card`"),
becomes a full anatomy of the redesigned frame: the desktop split geometry, the composed brand
panel and its bracket-embrace signature, the tagline, and the responsive, RTL, and dark behaviour.
The other pre-auth pieces — `LanguageToggle`, `PasswordField`, the form Fields — stay retheme deltas
under #6.

A separate `/implement` builds the frame against `apps/web/src/components/auth-layout.tsx` and the
four pre-auth routes. Map #116's destination — a signed-off mockup, an extended spec, and this ADR —
is reached when this record lands.

The boundary is the durable part. A future contributor who sees a richly designed login beside plain
rethemed interior surfaces should read this ADR rather than assume the login is a mistake and "fix"
it back to a centred card, or spread the split into authenticated surfaces on the theory that the
system now allows redesign. The exception is the pre-auth frame, and only the pre-auth frame. If the
client ever commissions a broader visual identity, that is a new effort that would supersede this
boundary at its own reserved scope; nothing here opens the interior to redesign.
