# Brand identity is composed from the client's existing mark, not redrawn

Status: accepted. Decided while grilling the visual-design scope that the design-system
foundation (#100) carved out (design-system map #65). Not security-sensitive. Establishes a
scope boundary and records what the build deliberately does not do.

## Context

The design-system spec puts iconography and imagery out of scope (principles.md, components.md),
and #100 pushed the brand mark, wordmark, PWA icon, nav and assistant iconography, and
empty-state art to "a separate visual-design pass." Two problems sat under that phrasing. The
pass was a phantom — every consumer deferred to it (the shell header wants a wordmark, the
assistant surface wants an assistant mark, the PWA needs an installable icon) and no ticket owned
it. And an away-from-keyboard build agent cannot originate visual design, so anything genuinely
requiring a designer would stall, while the app still needs an installable icon, a favicon, and a
legible light-theme header now.

The premise "an agent can't design a mark, so it is all out of scope" turned out to be too broad
once the facts were on the table. #66 confirmed the complete brand asset set already exists in
assets/brand/: logo-wordmark-white.svg and icon-mark-white.svg (monochrome vectors) and
app-icon-192.png. #66 itself already anticipated that "a full icon/favicon set, any dark/coloured
lockups, and splash art are generated at build time (the hand-off), not provided now." So most of
what #100 deferred is not design at all — it is mechanical composition of assets we already hold.

## Decision

Compose, do not redraw. The build productionizes the client's existing mark and wordmark into the
full on-system asset set — recoloured to the tokens, composed into the app/PWA icon, generated
into the icon and favicon size set, and derived into an assistant mark from the same geometry. The
corporate letterform itself is never redrawn. That letterform is Burgers Bar's identity, confirmed
complete by the client (#66); inventing or replacing a corporate mark is a client decision, not a
build task, and it is the one place agent output genuinely risks looking generic.

Because the work is composition of an existing monochrome vector in the decided tokens, a build
agent produces it and a human reviews it visually — it does not need a separate human
visual-design pass. The app/PWA icon is the gold-hero tile (the ink mark on --bb-gold-400, ink on
gold per primary/primary-foreground, never white); the favicon drops to the brackets-only glyph
below roughly 24px, where the full "B + brackets" muddies.

The identity assets live in a dedicated implementation umbrella, #103, under design-system map
#65, sequenced right after #100; #100's out-of-scope bullet is narrowed to point there in the same
change. Nav tab glyphs are library picks owned by the shell (#80), not identity work.

Empty-state illustration is deferred. The one genuinely original slice — empty-state art — is not
built for v1. Empty states ship type-only, as a headline and subtext in the type system, and
illustration is an additive post-v1 drop-in at a reserved slot. With that, no human visual-design
pass is required for v1 at all; the deferred pass is resolved, not left dangling.

## Considered options

Redrawing a new corporate mark on-system — an agent or a designer producing a fresh logo tuned to
the gold system — was considered and rejected. It oversteps the client's identity (a staff-app
build does not get to replace a real chain's logo), it is close to a one-way door once staff
associate a new mark with the brand, and it is the one task where agent output tends to the
generic. A rebrand, if the client ever wants one, is theirs to commission and would supersede the
composed assets at their reserved slots.

Holding the whole mark/wordmark/PWA-icon as a human visual-design pass — the way #100 originally
framed it — was rejected. Most of it is mechanical composition of assets we already have, so a
human pass would be gold-plating against the clix right-sizing (delivery first, do not gold-plate
the non-delivery work), and it would block installability and light-theme header legibility on
work nobody had scheduled.

Commissioning empty-state illustration as a v1 human task was rejected for v1 for the same
right-sizing reason: type-only empty states are complete, accessible, and shippable, and
illustration is a cheap additive later.

## Consequences

#100's out-of-scope bullet is narrowed in the same change: identity assets route to #103, nav
glyphs to the shell #80, empty-state art to type-only for v1. #103 is created under map #65 as the
second implementation umbrella in the #53 route, consumed by the shell (#80, header wordmark) and
the assistant surface (#93, assistant mark).

The design-system spec documents are left unchanged. They never named a human pass and still carry
no iconography guidance; what this ADR fixes is the delivery mechanism (agent composition versus a
deferred human pass), which is a build fact, not a spec fact. principles.md and components.md
remain accurate as written.

The boundary is the durable part: on this project, brand assets are recoloured and composed, never
redrawn. A future contributor who sees composed icons and no logo-design work, or type-only empty
states, should read this rather than assume branding was skipped or "fix" it by generating a new
mark. If the client later commissions a rebrand or bespoke illustration, that supersedes the
composed assets at their reserved slots; nothing here locks the identity in.
