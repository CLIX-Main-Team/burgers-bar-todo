# The UI icon system is Phosphor, wrapped behind a semantic role registry

Status: accepted. Decided while resolving the iconography map (#142), closing its pick ticket #145
and recorded by #146. Not security-sensitive. Chooses the free icon library, its dependency and
wiring shape, and the conventions the eventual build obeys, so the choice is not silently re-litigated
when someone reaches for a bare Phosphor import or a different library.

Numbered 0020 because the 0019 slot was taken by
`0019-full-stack-e2e-with-fixture-cast.md` between this branch's cut and its merge, and 0018 is
itself a prior collision — **two** files claim it (`0018-assistant-provider-switch.md` and
`0018-pre-auth-frame-redesign-exception.md`). This record takes the next genuinely free number
rather than a second 0019 or a third 0018.

## Context

The staff app needs a coherent set of UI glyphs — tab-bar destinations, send, close, chevrons, the
password toggle, task-status marks, priority and toast affordances — across `apps/web`. Today there
is exactly one hand-rolled inline SVG (`shell/account-menu.tsx`); everything else is unbuilt. The
design system at `docs/design-system/` is the authority these glyphs must obey: directional icons
mirror in RTL and universal ones do not (principle 2 and the RTL/LTR conventions), icons take the
`foreground`/`*-foreground` token colours, and the 44px touch floor governs icon *buttons*
(accessibility bar, tokens.md touch targets).

This is the **UI glyph** system only. The bespoke brand mark — app/PWA icon, favicon, wordmark,
assistant mark — is a separate, already-built concern owned by the brand-identity umbrella (#103,
ADR-0016); these icons sit alongside it and do not replace it.

Map #142 charted the decision across a candidate survey (#143), an in-brand head-to-head prototype
(#144), and a grilling that locked the system (#145). The survey shortlisted three zero-gap, freely
licensed, `currentColor`, tree-shakeable React libraries — **Phosphor**, **Lucide**, and **Tabler** —
and dropped Heroicons and Radix on role-coverage gaps and Remix on licence. The prototype drew all
**39 roles** in the two finalists (Phosphor, Lucide) in the decided tokens, light and dark, LTR and
RTL.

## Decision

Adopt **Phosphor** (`@phosphor-icons/react`, MIT) as the app's UI icon library, consumed as an npm
package via tree-shaken named imports, addressed through a thin shared `<Icon>` wrapper backed by a
semantic role registry.

**Library — Phosphor.** Its warm, rounded terminals fit the cream-and-gold brand and the humanist
Assistant type face, and — decisively — its `regular → fill` weight axis gives the active/selected
state a real second signal beyond colour. Lucide, the runner-up, is clean and shadcn-native but can
only signal active by colour; that marginal wiring edge did not outweigh style plus the weight axis.
Phosphor also ships first-party directional mirrors. All three finalists were zero-gap on our roles.

**Dependency shape — npm package, tree-shaken named imports.**
`import { PaperPlaneTilt } from '@phosphor-icons/react'`. Not a copied SVG set and not a sprite —
both would discard the runtime weight axis and the `mirrored` prop that justified the pick. `apps/web`
is a pure Vite / React client SPA with **no SSR**, so Phosphor's barrel concern is not an SSR-safety
issue here; it reduces to Vite dev pre-bundling plus production tree-shaking, which Rollup handles for
named imports. All 39 roles are used, so a static registry map tree-shakes with zero waste.

**Addressing — a thin shared `<Icon>` wrapper over a semantic role registry.** Consumers write
`<Icon name="send" />`; they never import a Phosphor glyph name. One registry module is the single
source of truth mapping role → glyph + directional flag + default weight — the 39-row table becomes
live code, and directionality is *data*, not a per-call flag a call site can forget. Rejected: bare
imports (re-implements RTL, sizing, and a11y at every call site) and pass-the-glyph (scatters the
mapping and pushes directionality back to call sites).

**RTL mirror — CSS keyed on the ambient `dir`.**
`[dir="rtl"] .icon--directional { transform: scaleX(-1); }`. The wrapper tags directional icons with
the class; the flip rides the `dir="rtl"` that `LocaleProvider` already stamps on `<html>`. The
wrapper stays purely presentational — no locale-context subscription, no re-render on language
switch. Phosphor's first-party `mirrored` prop is the sanctioned alternative (identical `scaleX(-1)`
under the hood); its existence validated the pick, but the flip need not route through JS. Four roles
are directional: back (`arrow-left`), row-forward/next (`caret-right`), send (`paper-plane-tilt`),
log out (`sign-out`).

**Weight — two weights only; `fill` reserved for the active/selected state.** Every icon is `regular`
at rest. `fill` fires in exactly two places, as the active-state signal: the active BottomNav
destination, and the current task status in a StatusControl/Badge. Everything else stays `regular`.
No thin/light/bold/duotone. The discipline mirrors how the system reserves gold for one primary
action — reserving `fill` keeps the weight jump meaningful.

**Sizing — named `sm`/`md`/`lg` = 16/20/24px, default `md`.** Each equals a Tailwind step
(`size-4`/`size-5`/`size-6`), matching the system's "named role = Tailwind step" pattern. Colour is
`currentColor`, inheriting the surrounding `foreground`/`*-foreground` token — no `color` prop on the
wrapper. Visual size is decoupled from the 44px hit area, which the *button* owns, so `sm`/`md` glyphs
still live inside 44px tap targets.

**Accessibility — decorative by default, one labelled escape hatch.** The wrapper renders
`aria-hidden="true"`; the accessible name comes from the surrounding control, and icon-only buttons
carry `aria-label` on the *button* so the glyph is not double-announced. An optional `label` prop
flips a standalone meaningful glyph to `role="img"` + `aria-label` and drops `aria-hidden`.

The full role→glyph mapping table, the directional set, and the "how to add an icon" recipe live in
the spec at `docs/design-system/iconography.md`, which this ADR governs.

## Considered options

**Lucide** was the runner-up and was rejected. It is clean, shadcn-native, and zero-gap, but signals
the active state by colour alone; it has no weight axis to give active nav and current status the
second, non-colour signal Phosphor's `regular → fill` provides. Its shadcn-native wiring edge is
marginal in an app that routes every glyph through its own `<Icon>` wrapper regardless of library.

**Tabler** cleared the survey (MIT, `currentColor`, tree-shakeable, zero-gap) but was not a finalist:
it offers neither Phosphor's warm-rounded brand fit nor a comparable rest-vs-active weight axis, so it
had no axis on which to beat the two finalists.

**Heroicons and Radix** were dropped in the survey on role-coverage gaps, and **Remix** on its
licence — none could cover the 39 roles under a free, permissive licence without holes.

**A copied SVG set or a sprite** (vendoring the glyphs instead of the npm package) was rejected: both
freeze the icons as static paths and discard exactly the two runtime affordances — the `fill` weight
axis and the `mirrored`/`scaleX` directional flip — that the library was chosen for. With no SSR and
all 39 roles in use, the npm package tree-shakes to the same payload without the loss.

## Consequences

A new spec, `docs/design-system/iconography.md`, is added under the design system and indexed in its
`readme.md`; it carries the full 39-role mapping table and the wrapper/registry conventions as the
authority the build implements. The design-system set grows from three documents (principles, tokens,
components) to four.

A later `/implement` — not this record — installs `@phosphor-icons/react`, builds the `<Icon>` wrapper
and the role registry, adds the one-line RTL CSS rule, and replaces the hand-rolled inline SVG in
`shell/account-menu.tsx` (which already follows the `size-6` / `currentColor` / `aria-hidden` /
44px-button conventions this formalises). Map #142's destination — the decided library, wiring, and
mapping, captured as ADR + spec — is reached when this record and the spec land.

The durable boundary is that call sites address icons by **role**, never by Phosphor glyph name. A
future contributor who reaches for a bare `@phosphor-icons/react` import, or proposes swapping the
library, should read this ADR: the wrapper/registry indirection is deliberate (it owns RTL, sizing,
and a11y once, and makes directionality data), and a library change is a registry-level edit, not a
call-site sweep. This decision covers UI glyphs only; the brand mark stays with ADR-0016 and #103.
