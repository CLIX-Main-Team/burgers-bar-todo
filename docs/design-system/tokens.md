# Design tokens

The token layer of the Burgers Bar staff-app design system: the named values every component
draws from, with light and dark defined from the start. This document is assembled across the
token tickets, one section per decision. The colour system (ticket #70), the layout tokens —
spacing, radius, elevation, breakpoints, and touch targets (ticket #72) — and the typography
system — family, weights, and type scale (ticket #71) — are all decided here.

Read principles.md first. It sets the accessibility bar these tokens are built to meet — WCAG 2.2
AA, text contrast at least 4.5:1, large text and meaningful UI parts at least 3:1, and a visible
focus indicator — and the Hebrew-first, retheme-not-redesign stance the token names inherit.

## Token architecture

The tokens follow the three-tier model settled by the theming-architecture research (ticket #68),
stated here in the shape the values drop into CSS. It is recorded so every section below can be
read as either a set of decisions or a set of custom properties.

Tier 1 is the brand primitives: raw, theme-independent brand values as plain custom properties in
:root, named --bb-<hue>-<step>. They are deliberately kept out of Tailwind's @theme block so they
generate no utilities and can never be used directly in a component. Each has exactly one value and
does not vary by theme.

Tier 2 is the semantic tokens: shadcn's canonical names (background/foreground, card, popover,
primary, secondary, accent, destructive, muted, border, input, ring), each defined as a reference
to a Tier-1 primitive. Colour is the one family that is defined twice — light values in :root, dark
values in .dark — so the two themes share names and differ only in which primitive each points at.
The names are kept exactly as shadcn ships them because the inherited apps/web ui/* primitives map
onto them one-to-one; keeping the names is what makes this spec implementable verbatim against
those files. Two status roles shadcn does not define — success and warning — are added alongside as
peer tokens.

Tier 3 is the Tailwind bridge: an @theme inline block mapping every semantic colour token to a
--color-* utility name. The inline keyword is required so the .dark overrides propagate to the
generated utilities; without it the utility captures the resolved value instead of a live
reference. Components then paint with bg-background, text-foreground, bg-primary
text-primary-foreground, border-border, ring-ring, and the retheme is repointing the primitives'
current hardcoded utilities (bg-slate-900, bg-white, text-red-700) at these.

Light and dark are class-based and explicit, never prefers-color-scheme: the variant is overridden
once with @custom-variant dark (&:where(.dark, .dark *)), light values live in :root and dark
values in .dark, and a small theme provider stamps .dark on document.documentElement the way
LocaleProvider already stamps dir and lang, persisting the choice. color-scheme is set to light on
:root and dark under .dark so native controls and scrollbars follow. Direction (RTL/LTR) is handled
entirely by logical properties and has no bearing on colour.

## Colour

### The decisions

One brown, one blue, one cream. The 2026-08 palette revision (owner decision, superseding the
gold-led scheme and ticket #67's no-blue rule) centres the app on the brand site's actual
front-page palette: black, white, the interaction blue #297DE1, a single chocolate brown #5F4A32,
the warm cream #FEF3E3, and the signature tan-to-chocolate header gradient. The earlier reading of
the site's blue as "an Elementor default, not a brand choice" did not survive contact with the
rendered page — the blue carries the site's order button, active navigation, and whole panels, and
the app adopts it for exactly that job.

Blue is interaction, brown is identity. The blue carries the primary action, active navigation,
selection, and focus — painted with white, the pairing the brand site itself uses — and is spent
on one primary action per screen, keeping the calm one-primary-action density principle. The
chocolate brown is the brand's voice, not a control colour: it is the secondary and muted ink on
the warm surfaces, the OS chrome tint, and the dark stop of the gradient. The tan #B99666 exists
only inside the gradient — never as a standalone fill — which is what keeps "one brown" true.

The gradient is the signature, and it is rationed. --bb-gradient-brand is
linear-gradient(90deg, tan → chocolate), the site's own header sweep (its two hand-typed stop
variants #BA9666/#5F4B32 corrected to the palette values). It appears on one identity surface —
the pre-auth brand panel and phone hero — and never backs dense UI or running text. It used to
ground the mark tile in both shells' headers too; from 2026-08-11 that mark is drawn bare,
exactly as the browser-tab icon is, inheriting the theme's ink (owner call).

App icons do not wear it either, as of the same date: every home-screen tile — Android launcher,
PWA, apple-touch — is the dark canvas #151412 carrying the mark in #F7F7F5, so the icon you tap
is the two colours of the screen it opens. It began as an Android-launcher-only call and was
extended to the web tiles once Add-to-Home-Screen became the iOS delivery route, which would
otherwise have put two different app icons on two phones in the same pocket. A two-stop gradient
behind a thin letterform also does not survive 48px. The browser tab is the one icon still
outside this rule: it is the site's own favicon, shipped verbatim (owner call 2026-08).

Three consequences for the functional hues:

- Warning stays a burnt orange, deliberately pushed off the gradient's tan toward red-orange, so
  the brand's warm metals and "something needs attention" never read as the same colour.
- There is still no dedicated info colour. Blue now exists, but it means interaction, not
  information — an informational blue chip would read as a control. Info stays on the neutral
  muted surface and muted-foreground, and shadcn defines no info role in any case.
- Success stays an earthy olive green and danger a brick red — both warm-leaning so they sit
  inside the brown-and-cream family rather than reading as generic system colours.

Dark mode is designed with the same care as light, not derived by flipping it, and the same blue
carries the primary so both themes share one interaction language. Its canvas is neutral
near-black: the neutral ramp extended downward (#151412 and its steps), stopping short of pure
black so a card still reads as a lighter surface above the ground rather than relying on its
border alone. Ink is neutral near-white to match.

The 2026-08-11 revision (owner decision) is what made it neutral. Dark previously grounded on the
chocolate shaded to near-black with cream type — one hue, deliberately warm — and in practice
read as sepia rather than as a dark theme. Brown and cream did not leave the palette; they moved
to the roles where they are brand rather than background: the gradient panel behind the sign-in
form, and the warm orange the not-started lane already wore. The mark in both shells and the
browser-chrome tint follow the theme's ink and canvas from that point on.

The 2026-08 neutral revision (owner decision, modelled on the team CRM's light theme): the light
canvas and its grey ramp move off the cream family onto warm near-white neutrals — the CRM's
#F7F7F5 ground, #F0F0EE recessed surface, #E3E2E0 hairline — and the muted ink becomes a neutral
grey rather than the brown. Cream is not deleted: it remains the brand's identity colour on the
gradient lockup and the pre-auth panel; it just stops being the everyday light canvas (and, from
the 2026-08-11 dark revision above, the dark ink). The soft status pairs move to the CRM's orange/blue/green set at the same
time (below), because the board now names its lanes by those colours.

### Tier 1 — brand primitives

Drawn from the brand site's front page (2026-08 revision); derived steps are interpolations of
those brand values, kept warm.

Neutral poles: --bb-white #FFFFFF and --bb-black #000000 (the brand's text black).

Brown, the one brand brown: --bb-brown #5F4A32 (the chocolate — the palette's only standalone
brown; the gradient's dark stop and the light theme's browser-chrome tint). Its darkened steps
are gone as of the 2026-08-11 dark revision — the dark theme grounded on them and now grounds on
the neutral ramp.

The gradient: --bb-tan #B99666 is the light stop of --bb-gradient-brand,
linear-gradient(90deg, tan → chocolate) — the site's header sweep. The tan is gradient-only,
never a standalone fill.

Cream: --bb-cream #FEF3E3, the brand cream — the ink that rides the gradient, i.e. the pre-auth
panel and the wordmark lockup on it. Not a canvas in either theme and, since the 2026-08-11 dark
revision, not the dark ink either; its mixed-toward-brown steps went with that change.

Neutrals, the ground for both themes: --bb-neutral-50 #F7F7F5 (the light canvas, and the dark
theme's ink), --bb-neutral-100 #F0F0EE (light recessed surface), --bb-neutral-200 #E3E2E0 (light
hairline, dark ink on the quiet secondary surface), --bb-neutral-300 #CFCEC9 (dark muted ink),
--bb-neutral-400 #94928C (light input border), --bb-neutral-500 #6F6D67 (dark input border),
--bb-neutral-600 #5C5A54 (light muted ink), --bb-neutral-800 #37352F (light ink on the quiet
secondary surface, dark hairline), --bb-neutral-850 #2B2A26 (dark recessed surface),
--bb-neutral-900 #201F1C (dark card), --bb-neutral-950 #151412 (the dark canvas). The light steps
came from the team CRM in 2026-08; the 850–950 near-blacks were added on 2026-08-11 so one
faintly warm family carries both themes, which is what keeps the surviving brand accents from
reading as strays against a colder grey.

The 400 and 500 steps are the control-boundary pair, added 2026-08-11 when the login screen was
reworked: input borders had been sitting on 300 in light and on a since-deleted 700 #4B4942 in
dark, which drew a 1.55:1 and a 1.83:1 hairline respectively. At that contrast a filled field on
a card read as a disabled block rather than as somewhere to type. 400 and 500 are the lightest
and darkest values that still clear the 3:1 non-text contrast bar for a control boundary against
their own theme's card.

Blue, the interaction hue: --bb-blue-100 #EAF2FC (pale accent surface), --bb-blue-300 #7FB0EE
(dark accent ink), --bb-blue-500 #297DE1 (the site's brand blue — primary and ring),
--bb-blue-600 #1E64B6 (the site's hover blue — accent ink on light), --bb-blue-950 #16293F
(dark accent surface).

Functional hues, warm-leaning: green --bb-green-300 #86B86F and --bb-green-600 #46703B; orange
--bb-orange-300 #EBB363 and --bb-orange-600 #9E5A0E; red --bb-red-400 #E0705C, --bb-red-600
#B23A2B, and --bb-red-950 #241010 (ink for text on the light-red dark-theme fill).

### Tier 2 — semantic tokens

Each role is given as: what it is for, then its light value and its dark value, named by primitive.

Surfaces and ink:

- background — the app canvas. Light --bb-neutral-50; dark --bb-neutral-950.
- foreground — default text and icons on the canvas. Light --bb-black; dark --bb-neutral-50.
- card, popover — raised surfaces. Light --bb-white; dark --bb-neutral-900. Their -foreground
  matches foreground (black / near-white).
- muted — a recessed surface for secondary rows, disabled fills, and info-level chips. Light
  --bb-neutral-100; dark --bb-neutral-850.
- muted-foreground — secondary and metadata text; also the ink of neutral info chips. Light
  --bb-neutral-600; dark --bb-neutral-300.
- border — hairlines and dividers. Light --bb-neutral-200; dark --bb-neutral-800.
- input — form-control borders. Light --bb-neutral-400; dark --bb-neutral-500. Both clear 3:1
  against their theme's card, so a field reads as a field before it is focused.

Brand and action:

- primary — the primary action fill. Light and dark both --bb-blue-500.
- primary-foreground — text and icons on primary. Light and dark both --bb-white — the brand
  site's own pairing on its order button.
- secondary — the quiet, non-primary button and surface. Light --bb-neutral-100; dark
  --bb-neutral-850.
- secondary-foreground — text on secondary. Light --bb-neutral-800; dark --bb-neutral-200.
- accent — a soft highlight surface for hover and selected states. Light --bb-blue-100; dark
  --bb-blue-950.
- accent-foreground — ink on the accent surface, and the assistant's emphasis/link colour. Light
  --bb-blue-600 (the site's hover blue); dark --bb-blue-300.
- ring — the focus indicator. Light and dark both --bb-blue-500 (clears 3:1 on cream, white, and
  the dark canvas).

Status:

- destructive — danger fills and destructive actions. Light --bb-red-600; dark --bb-red-400.
- destructive-foreground — text on destructive. Light --bb-white; dark --bb-red-950.
- success — confirmation fills. Light --bb-green-600; dark --bb-green-300.
- success-foreground — text on success. Light --bb-white; dark --bb-neutral-950.
- warning — attention fills. Light --bb-orange-600; dark --bb-orange-300.
- warning-foreground — text on warning. Light --bb-white; dark --bb-black.

There is deliberately no info, chart, or sidebar token in this set. Info folds into muted (above);
chart and sidebar families are added later only if a v1 surface needs them, per the theming
research.

### Soft status variants

Chips, badges, and toasts use a tinted surface with darker ink rather than the solid status fill,
which keeps small status text comfortably above 4.5:1 in both themes. They are peer tokens
(--<status> and --<status>-muted with a matching -foreground):

The light pairs are the team CRM's soft status pairs (2026-08 neutral revision):

- success soft — light surface #E4F3E9 with ink #2C7A4B; dark surface #26301B with ink #A9C98C.
- warning soft — light surface #FBECDB with ink #A05A10 (the CRM ships #B56A1A here, darkened to
  clear 4.5:1 on the soft orange); dark surface #3A2A11 with ink #EBB363.
- destructive soft — light surface #FCE5E1 with ink #C0392B; dark surface #3A211B with ink
  #EB9384.
- info / neutral soft — the muted surface with muted-foreground; no dedicated hue.

Task statuses carry their own dedicated tone pairs — the one colour a status wears on lane heads,
the mobile status tabs, and the card's StatusControl pill (board-columns.ts STATUS_TONE). Blue and
green are copied verbatim from the CRM board's column pills (owner call 2026-08); not-started
diverges from the CRM's neutral gray by a second owner call the same month, swapping colours with
the backlog chip — orange reads as "waiting for someone", and the backlog chip went neutral muted:

- status-not-started — the warm orange soft pair: light surface #FBECDB with ink #A05A10; dark
  surface #3A2A11 with ink #EBB363 (the warning-soft values, as a distinct role).
- status-in-progress — the CRM's own soft blue (not the brand interaction blue): light surface
  #E4EEF8 with ink #2F6DB5; dark surface rgba(47,109,181,.24) with ink #8FC0EF.
- status-done — soft green: light surface #E4F3E9 with ink #2C7A4B (the success-soft values, as a
  distinct role); dark surface rgba(44,122,75,.22) with ink #7FD6A0.

The blue and green dark surfaces are the CRM's translucent tints. Being alpha, they composite over
whatever surface they land on, so they carried across the 2026-08-11 move to a neutral dark canvas
unchanged. The two warm opaque pairs (not-started and warning soft) did not change either, and on
a neutral ground they are now the warmest thing on the screen — which is the intent: they read as
the same "waiting" orange the light theme uses.

### Accessibility conformance

Every pairing is measured against the WCAG 2.2 AA bar set in principles.md. Body foreground on
the canvas is about 19:1 light and 17:1 dark. The neutral muted-foreground clears about 6:1 on
the light canvas and 5.6:1 on the recessed surface; the dark theme's muted ink clears about 11.7:1
on the dark canvas and 10.5:1 on a card. Accent ink
is about 5.2:1 on the pale-blue surface light and 6.5:1 dark. White on the brand blue is the one
knowing trade-off: about 4.1:1 — above the 3:1 large-text and non-text bars, marginally under the
4.5:1 small-text bar. It is the brand site's own pairing on its order button; button labels ride
the 48px control, and any running blue text uses the deeper --bb-blue-600 (about 5.4:1 on cream)
instead. Small status text always uses the soft variants above rather than the solid fill; the
solid success and warning fills keep their darkened values (#46703B, #9E5A0E) so white labels
pass 4.5:1. Input borders clear the 3:1 non-text bar on their own theme's card — about 3.2:1 in
both, since the 2026-08-11 move onto the 400/500 control-boundary steps; before that they sat at
1.55:1 light and 1.83:1 dark, below the bar and, more to the point, below the level at which an
unfocused field looks like one. The focus ring (brand blue) clears 3:1 against canvas, card, and the dark canvas. The
tan appears only inside the gradient, and text on the gradient is the cream wordmark or white at
hero sizes only (about 4.2–4.6:1 at the mid-sweep), never running text.

### Reference CSS

The whole colour system as it drops into apps/web/src/index.css. This is the implementable form of
everything above; the build feature that wires the theme (out of scope for this map) starts here.

```css
@custom-variant dark (&:where(.dark, .dark *));

:root {
  color-scheme: light;

  /* Tier 1 — brand primitives (not in @theme; never used directly) */
  --bb-white: #FFFFFF;     --bb-black: #000000;
  --bb-brown: #5F4A32;     --bb-tan: #B99666;
  --bb-gradient-brand: linear-gradient(90deg, var(--bb-tan) 0%, var(--bb-brown) 100%);
  --bb-cream: #FEF3E3;
  --bb-neutral-50: #F7F7F5;  --bb-neutral-100: #F0F0EE; --bb-neutral-200: #E3E2E0;
  --bb-neutral-300: #CFCEC9; --bb-neutral-400: #94928C; --bb-neutral-500: #6F6D67;
  --bb-neutral-600: #5C5A54;
  --bb-neutral-800: #37352F; --bb-neutral-850: #2B2A26; --bb-neutral-900: #201F1C;
  --bb-neutral-950: #151412;
  --bb-blue-100: #EAF2FC;  --bb-blue-300: #7FB0EE;  --bb-blue-500: #297DE1;
  --bb-blue-600: #1E64B6;  --bb-blue-950: #16293F;
  --bb-green-300: #86B86F; --bb-green-600: #46703B;
  --bb-orange-300: #EBB363; --bb-orange-600: #9E5A0E;
  --bb-red-400: #E0705C;   --bb-red-600: #B23A2B;   --bb-red-950: #241010;

  /* Tier 2 — semantic (light) */
  --background: var(--bb-neutral-50);      --foreground: var(--bb-black);
  --card: var(--bb-white);                 --card-foreground: var(--bb-black);
  --popover: var(--bb-white);              --popover-foreground: var(--bb-black);
  --primary: var(--bb-blue-500);           --primary-foreground: var(--bb-white);
  --secondary: var(--bb-neutral-100);      --secondary-foreground: var(--bb-neutral-800);
  --muted: var(--bb-neutral-100);          --muted-foreground: var(--bb-neutral-600);
  --accent: var(--bb-blue-100);            --accent-foreground: var(--bb-blue-600);
  --destructive: var(--bb-red-600);        --destructive-foreground: var(--bb-white);
  --success: var(--bb-green-600);          --success-foreground: var(--bb-white);
  --warning: var(--bb-orange-600);         --warning-foreground: var(--bb-white);
  --border: var(--bb-neutral-200);         --input: var(--bb-neutral-400);
  --ring: var(--bb-blue-500);

  /* soft status variants */
  --success-muted: #E4F3E9;    --success-muted-foreground: #2C7A4B;
  --warning-muted: #FBECDB;    --warning-muted-foreground: #A05A10;
  --destructive-muted: #FCE5E1; --destructive-muted-foreground: #C0392B;

  /* task-status tones (blue/green from the CRM board's column pills; not-started on the
     warm orange after the owner's swap with the backlog chip) */
  --status-not-started: #FBECDB; --status-not-started-foreground: #A05A10;
  --status-in-progress: #E4EEF8; --status-in-progress-foreground: #2F6DB5;
  --status-done: #E4F3E9;        --status-done-foreground: #2C7A4B;
}

.dark {
  color-scheme: dark;
  --background: var(--bb-neutral-950);     --foreground: var(--bb-neutral-50);
  --card: var(--bb-neutral-900);           --card-foreground: var(--bb-neutral-50);
  --popover: var(--bb-neutral-900);        --popover-foreground: var(--bb-neutral-50);
  --primary: var(--bb-blue-500);           --primary-foreground: var(--bb-white);
  --secondary: var(--bb-neutral-850);      --secondary-foreground: var(--bb-neutral-200);
  --muted: var(--bb-neutral-850);          --muted-foreground: var(--bb-neutral-300);
  --accent: var(--bb-blue-950);            --accent-foreground: var(--bb-blue-300);
  --destructive: var(--bb-red-400);        --destructive-foreground: var(--bb-red-950);
  --success: var(--bb-green-300);          --success-foreground: var(--bb-neutral-950);
  --warning: var(--bb-orange-300);         --warning-foreground: var(--bb-black);
  --border: var(--bb-neutral-800);         --input: var(--bb-neutral-500);
  --ring: var(--bb-blue-500);

  --success-muted: #26301B;    --success-muted-foreground: #A9C98C;
  --warning-muted: #3A2A11;    --warning-muted-foreground: #EBB363;
  --destructive-muted: #3A211B; --destructive-muted-foreground: #EB9384;

  /* task-status tones — warm dark pair for not-started; the CRM's translucent tints for
     blue and green */
  --status-not-started: #3A2A11;                  --status-not-started-foreground: #EBB363;
  --status-in-progress: rgba(47, 109, 181, 0.24); --status-in-progress-foreground: #8FC0EF;
  --status-done: rgba(44, 122, 75, 0.22);         --status-done-foreground: #7FD6A0;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  /* soft status variants (bg-success-muted / text-success-muted-foreground, …) */
  --color-success-muted: var(--success-muted);
  --color-success-muted-foreground: var(--success-muted-foreground);
  --color-warning-muted: var(--warning-muted);
  --color-warning-muted-foreground: var(--warning-muted-foreground);
  --color-destructive-muted: var(--destructive-muted);
  --color-destructive-muted-foreground: var(--destructive-muted-foreground);

  /* task-status tones (bg-status-done / text-status-done-foreground, …) */
  --color-status-not-started: var(--status-not-started);
  --color-status-not-started-foreground: var(--status-not-started-foreground);
  --color-status-in-progress: var(--status-in-progress);
  --color-status-in-progress-foreground: var(--status-in-progress-foreground);
  --color-status-done: var(--status-done);
  --color-status-done-foreground: var(--status-done-foreground);
}
```

## Layout

### The decisions

The layout tokens are a full named scale, deliberately aligned to Tailwind's built-in numeric
scale. Every value below is expressed as a named --bb-* role and set to a value an existing
Tailwind utility already resolves to, so the two never disagree: p-4 and p-md are the same 16px,
rounded-lg and radius-lg the same 12px. This gives the self-documenting, swappable system the map
asked for while keeping the retheme honest — the inherited components keep their current numeric
utilities and adopt the named roles opportunistically, with no rewiring pass. Custom breakpoints
and a parallel numbering system were both avoided for the same reason: a second scale that drifts
from Tailwind's would cost sync for no delivery gain.

The scale serves comfortable density only, the sole density v1 ships (principle 3). Because spacing
is fully tokenised as named roles, a later compact density is introduced by redefining the
--bb-space-* values (and --bb-control-height) in one place, with no component re-spec — the named
spacing scale is that swap point. This is a deliberately reversible door, not a one-way one.

### Spacing

An eight-step t-shirt scale on a 4px base grid; each step is a multiple of 4 and equals its named
Tailwind step. The 2px half-step was dropped as noise at comfortable density.

- 2xs — 4px (0.25rem), Tailwind 1. Hairline gaps, icon-to-label nudge.
- xs — 8px (0.5rem), Tailwind 2. Tight internal padding, chip padding.
- sm — 12px (0.75rem), Tailwind 3. Compact row gaps, control inner padding.
- md — 16px (1rem), Tailwind 4. The workhorse: component inner padding and screen edge margins.
- lg — 24px (1.5rem), Tailwind 6. Spacing between sections and stacked cards.
- xl — 32px (2rem), Tailwind 8. Major section breaks.
- 2xl — 48px (3rem), Tailwind 12. Page-level rhythm, empty-state breathing room.
- 3xl — 64px (4rem), Tailwind 16. Large hero and onboarding spacing.

Comfortable-density defaults the component spec inherits: component inner padding md, list and row
gaps sm to md, spacing between sections lg, screen edge margins md.

### Radius

A soft, premium-casual feel: a 12px base, above shadcn's 10px default without tipping into playful.
Following the theming architecture, shadcn's --radius is the one canonical radius token, set to the
lg step, with the rest derived from it by calc so a single change restyles the whole system.

- sm — 8px (base − 4). Inputs, small controls, badges.
- md — 10px (base − 2). Buttons, chips.
- lg — 12px (the base, --radius). Cards, sheets, dialogs — the default surface radius.
- xl — 16px (base + 4). Large surfaces and bottom sheets.
- full — 9999px. Avatars, pills, toggle knobs.
- none — 0. Available, rarely used.

### Elevation

Separation is borders-first: on-page surfaces (cards, list rows) are set apart by a border or a
surface tint, keeping the screen calm and flat. Shadows are reserved for things that genuinely
float above the page. The shadows are soft and diffuse, warm-tinted from the brand ink
(rgb(42 34 22)) rather than pure black, for the premium feel.

- 0 — none. Default page surfaces; separation via border or muted tint.
- sm — a subtle low shadow. Cards that need a slight lift, the sticky bottom navigation.
- md — a medium shadow. Popovers, dropdown menus.
- lg — a pronounced soft shadow. Bottom sheets, dialogs, toasts — the thumb-zone overlays.

Dark mode carries elevation mainly through lighter surface tints — a raised surface is a step
lighter (card is neutral-900 over the neutral-950 canvas, from the colour section) — because
shadows barely register on dark grounds. The shadow steps are kept but softened under .dark, present only enough to
seat the floating overlays.

### Breakpoints and layout width

Tailwind's default breakpoints are adopted unchanged: sm 40rem (640px), md 48rem (768px), lg 64rem
(1024px), xl 80rem (1280px), 2xl 96rem (1536px). No custom breakpoints are introduced.

The app is authored phone-first, but it is no longer one single column at every width. Below `md`
(768px) the phone shell is exactly that: a single column capped and centred at --bb-content-max,
30rem (480px), with the sticky header and bottom tab-bar. From `md` the app flips to the desktop
shell (built from the #175 mockup, `docs/design-system/mockups/shell/`, `apps/web/src/shell`): the
bottom tab-bar becomes a persistent --bb-sidenav (15rem) side nav at the inline-start, and the
content region widens to --bb-content-wide, 70rem (~1120px), centred in the space beside it. This is
an *addition* to the design system — the phone shell is unchanged and every token, component, and
icon is used as specified. Multi-column *content* (the board's status columns, the people table) is
a per-screen concern that flips at `lg` (1024px); the shell frame itself flips at `md`.

### Touch targets

Interactive elements meet the accessibility bar from principles.md — at least 44 by 44px, above the
WCAG 24px floor and in line with mobile-platform norms.

- --bb-touch-min — 44px. The hard floor: no interactive element's hit area is smaller than this in
  either dimension. This overrides the inherited controls, which ship at h-10 (40px) and are raised
  to meet it.
- --bb-control-height — 48px. The comfortable default height for buttons, inputs, select triggers,
  and list or navigation rows, sitting above the 44px floor in keeping with comfortable density.

Where a control is visually smaller than 44px by design — icon buttons, checkboxes, the close
control on a sheet — it keeps its small visual size but its tappable area is padded out to
--bb-touch-min; visual size and hit size are allowed to differ, and hit size never drops below 44px.
Adjacent targets are separated using the spacing scale (sm to md) so neighbours are not mis-tapped;
no dedicated token is needed for that.

### Reference CSS

The layout tokens as they extend apps/web/src/index.css, added to the same three blocks the colour
system defines. Spacing, radius, and breakpoint values do not vary by theme, so they are declared
once; the elevation shadows vary and are softened under .dark alongside the colour overrides.

```css
:root {
  /* Tier 1 — layout primitives (aligned to Tailwind's numeric scale) */
  --bb-space-2xs: 0.25rem; --bb-space-xs: 0.5rem;  --bb-space-sm: 0.75rem;
  --bb-space-md: 1rem;     --bb-space-lg: 1.5rem;  --bb-space-xl: 2rem;
  --bb-space-2xl: 3rem;    --bb-space-3xl: 4rem;

  --bb-radius-sm: 0.5rem;  --bb-radius-md: 0.625rem; --bb-radius-lg: 0.75rem;
  --bb-radius-xl: 1rem;    --bb-radius-full: 9999px; --bb-radius-none: 0;

  --bb-content-max: 30rem;      /* phone-shell content cap */
  --bb-content-wide: 70rem;     /* desktop-shell content cap (~1120px) */
  --bb-sidenav: 15rem;          /* desktop side-nav column (240px) */
  --bb-touch-min: 2.75rem;      /* 44px */
  --bb-control-height: 3rem;    /* 48px */

  /* shadcn's canonical radius token, set to the lg step */
  --radius: var(--bb-radius-lg);

  /* elevation — warm-tinted, light theme */
  --bb-elevation-0: none;
  --bb-elevation-sm: 0 1px 2px 0 rgb(42 34 22 / 0.08);
  --bb-elevation-md: 0 4px 12px -2px rgb(42 34 22 / 0.12);
  --bb-elevation-lg: 0 12px 32px -8px rgb(42 34 22 / 0.20);
}

.dark {
  /* elevation — softened; dark mode leans on surface tints, not shadow */
  --bb-elevation-sm: 0 1px 2px 0 rgb(0 0 0 / 0.40);
  --bb-elevation-md: 0 4px 12px -2px rgb(0 0 0 / 0.50);
  --bb-elevation-lg: 0 16px 40px -8px rgb(0 0 0 / 0.65);
}

@theme inline {
  /* named spacing utilities (p-md, gap-lg, …); numeric p-4 etc. still resolve via
     Tailwind's default --spacing base, so both forms name the same value */
  --spacing-2xs: var(--bb-space-2xs); --spacing-xs: var(--bb-space-xs);
  --spacing-sm: var(--bb-space-sm);   --spacing-md: var(--bb-space-md);
  --spacing-lg: var(--bb-space-lg);   --spacing-xl: var(--bb-space-xl);
  --spacing-2xl: var(--bb-space-2xl); --spacing-3xl: var(--bb-space-3xl);

  /* radius scale derived from --radius (rounded-sm/md/lg/xl) */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* elevation utilities (shadow-sm/md/lg); inline so the .dark overrides propagate */
  --shadow-sm: var(--bb-elevation-sm);
  --shadow-md: var(--bb-elevation-md);
  --shadow-lg: var(--bb-elevation-lg);
}
```

Breakpoints are Tailwind's defaults and are not redeclared; --bb-content-max, --bb-touch-min, and
--bb-control-height are consumed directly in component styles (max-inline-size, min-block-size)
rather than as generated utilities.

## Typography

### The decisions

The type system is a single family. The brand face is SimplerPro, a commercial Hebrew-and-Latin
humanist sans that carries both scripts in one family (ticket #67); the staff app does not hold a
SimplerPro licence and fonts are free-only (standing directive, ticket #66), so a free stand-in
carries the app. That stand-in was first Assistant (the closest free match to SimplerPro's warm
register); an owner call (2026-08) then aligned the staff app's typography with the team CRM, whose
face is Rubik — a free, Hebrew-and-Latin native geometric-rounded sans — so the two products read
as one family of tools. Rubik replaces Assistant under the same free-only directive. There is
deliberately no second display face and no separate Latin companion: the same family sets Hebrew
and English, and the single-family decision from the brand research is preserved. One
--bb-font-sans token carries it; there is no serif and no mono family, because nothing in v1
renders code — a mono token is added later only if a surface needs one.

Hierarchy is carried by weight, reproducing the brand's signature of light body against heavy
headings — but the body weight is 400, not the brand's 300. Weight 300 at body sizes on a phone is
thin, and it reads as lower contrast in practice because the accessibility ratios are measured on
the glyph strokes; it bites Hebrew harder still, which has no ascenders or descenders to aid word
recognition and leans more of the reading load onto stroke weight. The brand's home is a marketing
site — large type in short bursts — while this is a staff tool with sustained reading on small
screens, so the register genuinely differs and legibility wins for running text (principle 5,
and the occasional-user framing of the operating context). The weight contrast that makes the type
feel like the brand is kept by leaning on heavy headings against a regular body rather than a light
body; weight 300 survives only as a large, non-critical display option (a hero number, a caption at
a comfortable size), never as running body, label, or any interactive text. The register itself is
the CRM's bolder one (same owner call as the family): page titles at 800, section and card titles
at 600, buttons and form labels at 600, badges, pills, and counts at 700 with tabular figures, body
at 400 — hierarchy still carried by weight, just with a firmer hand than the earlier
everything-at-600 ladder.

The scale is one fixed, mobile-first scale — the CRM's denser one (owner call 2026-08): body 14px,
labels and buttons 13px, dialog and section titles 16px, page titles 26px, display 28px. It
deliberately no longer coincides with Tailwind's numeric text-* steps (body 14px ≠ text-base 16px);
components reach for the named roles, and the numeric utilities keep their stock Tailwind sizes.
There are no responsive or fluid type bumps: one scale serves every viewport. The 16px floor
survives as an input rule, not a body rule — form fields hold text-base 16px, the threshold below
which iOS auto-zooms a focused input; nothing interactive goes below 13px, and 12px is reserved
for captions, badges, and genuinely secondary metadata.

The rules that make the system Hebrew-first rather than a Latin scale with Hebrew poured in:

- Tracking is normal (0) on body, labels, and every running-text role — spacing Hebrew out is
  actively harmful because it is not a spaced script. The one exception, following the CRM: the
  extrabold heading roles (heading-md, heading-lg, display) carry a slight −0.01em tightening
  (--bb-tracking-tight, baked into the role utilities). Tightening is not the spacing-out the rule
  guards against, the CRM sets its own Hebrew headlines this way, and it applies through the role
  so no component carries a tracking class.
- There is no uppercase label style. Hebrew has no letter case, so text-transform: uppercase does
  nothing to Hebrew and would make the Hebrew and English UIs diverge; labels get their presence
  from weight 600 and size, never from casing.
- Numerals are Western Arabic 0–9 in both languages (principle: RTL/LTR conventions), set with
  tabular figures (font-variant-numeric: tabular-nums) in aligned numeric contexts — task counts,
  times, any column of numbers — so digits do not jitter; running text keeps proportional figures.
- Line-heights run a touch generous, which suits Hebrew's lack of ascenders and descenders (the eye
  leans on line spacing to track rows). The single scale's line-heights are chosen to serve Hebrew
  comfortably; there is no per-script line-height fork, which would add machinery the
  retheme-not-redesign stance avoids.

The bidi isolation of user-authored content — a Hebrew task title inside otherwise-English chrome,
and the reverse — is decided in principles.md (content follows its own direction, isolated from the
chrome) and is a component-layer concern; it is referenced here, not re-decided.

Delivery is self-hosted, not the Google Fonts CDN: this is a Capacitor app that must render offline
and should not fetch a font from a third party on every launch, so Rubik ships inside the app
bundle. Rubik is a variable font with a 300–900 weight axis, so a single file per subset covers the
whole range rather than shipping static weights; the standard self-host route is the
@fontsource-variable/rubik package, which registers the family as 'Rubik Variable' and ships the
Hebrew, Latin, and Latin-ext subsets the app uses (plus dormant, unicode-range-gated Arabic and
Cyrillic files that are bundled but never fetched by these locales). font-display is swap, so text
renders immediately in the fallback and swaps when Rubik loads, which is acceptable because the
fallback stack resolves to a Hebrew-capable UI font on every target OS. Naming the approach and the
tokens is this section's job; the actual @fontsource install and @font-face wiring is build
hand-off work, out of scope for this planning map, the same way the colour and layout sections stop
at reference CSS.

### Tier 1 — type primitives

The family stack, the weights in use, and the size/line-height scale as raw --bb-* values.

Family: --bb-font-sans is the stack 'Rubik Variable', 'Rubik', system-ui, -apple-system, 'Segoe
UI', 'Noto Sans Hebrew', Arial, sans-serif. Rubik is the app face; 'Rubik' covers a
system-installed static Rubik, and the remaining entries are the fallback shown until it loads and
the safety net if it fails, ordered so RTL never falls back to a Latin-only face.

Weights, the five in use plus the reserved light: --bb-weight-light 300 (reserved: large
non-critical display only), --bb-weight-regular 400, --bb-weight-medium 500, --bb-weight-semibold
600, --bb-weight-bold 700, --bb-weight-heavy 800. These line up one-to-one with Tailwind's
font-light / font-normal / font-medium / font-semibold / font-bold / font-extrabold utilities, so a
component can name the weight either way.

Tracking: --bb-tracking-tight −0.01em, worn only by the extrabold heading roles (heading-md,
heading-lg, display) through their role utilities; every other role stays at 0.

Size and line-height, each role a size paired with a line-height (the CRM's denser scale — the
named roles no longer coincide with Tailwind's numeric text-* steps):

- caption — 0.75rem (12px), line-height 1.4. Badges, counts, field labels, metadata.
- label — 0.8125rem (13px), line-height 1.4. Buttons, pills, navigation.
- body — 0.875rem (14px), line-height 1.45. Default running text; card titles at 600.
- heading-sm — 1rem (16px), line-height 1.35. Dialog and section titles.
- heading-md — 1.375rem (22px), line-height 1.25. Detail titles.
- heading-lg — 1.625rem (26px), line-height 1.2. Page h1.
- display — 1.75rem (28px), line-height 1.15. Hero and auth headline.

Inputs are the exception outside the role scale: they hold Tailwind's stock text-base (16px), the
iOS auto-zoom floor.

### Tier 2 — semantic roles

Each named role is a size, a weight, and the intent it carries. Roles reference the primitives
above; none vary by theme.

- display — display size, weight 800 (heavy) with tight tracking. Hero, onboarding, big numbers.
  The one role where the reserved 300 light is also allowed, as a deliberate large-light variant.
- heading-lg, heading-md — their matching sizes, weight 800 with tight tracking. Page and detail
  titles; the CRM's extrabold register.
- heading-sm — heading-sm size, weight 600 (semibold). Dialog and section titles; think h2, h3.
- body — body size, weight 400. Default running text.
- body-emphasis / card-title — body size, weight 600. Inline emphasis, links, and card titles.
- label — label size, weight 600 (semibold). Buttons and navigation — heavier than body so
  controls read as controls, never uppercased.
- caption — caption size, weight 400 for metadata and timestamps; field labels wear it at 600, and
  badges, pills, and counts at 700 with tabular figures (the CRM's chip register). De-emphasis is
  carried by size and the muted-foreground colour, never by a lighter weight.

### Accessibility conformance

The type meets the WCAG 2.2 AA bar set in principles.md. Body is weight 400 at 14px — Rubik's
larger x-height keeps it comfortably legible there — and weight 300 appears only as large,
non-critical display. Interactive text bottoms out at the 13px label role at weight 600, always
inside the 44px touch targets the layout section mandates; the 12px caption floor is held (badges
sit at 12px where the CRM dips to 11) and inputs stay at 16px, the mobile auto-zoom threshold.
Colour contrast is settled in the colour section — foreground on the canvas clears 12:1 in both
themes and muted-foreground clears 4.5:1 — and this section adds no pairing that undercuts it.
Generous line-heights, and tracking that only ever tightens slightly on large extrabold headings,
keep Hebrew and Latin running text comfortable to read.

### Reference CSS

The typography tokens as they extend apps/web/src/index.css, added to the same blocks the colour and
layout systems use. Type values do not vary by theme, so they are declared once in :root; the
@theme inline block maps the family and the named roles to utilities. Loading the Rubik font
files (the @font-face rules from @fontsource-variable/rubik) is build hand-off work and is not
shown here.

```css
:root {
  /* Tier 1 — type primitives */
  --bb-font-sans: "Rubik Variable", "Rubik", system-ui, -apple-system, "Segoe UI",
    "Noto Sans Hebrew", Arial, sans-serif;

  --bb-weight-light: 300;   /* reserved: large non-critical display only */
  --bb-weight-regular: 400; --bb-weight-medium: 500;   --bb-weight-semibold: 600;
  --bb-weight-bold: 700;    --bb-weight-heavy: 800;

  /* extrabold headings only; body and labels stay at browser-default tracking */
  --bb-tracking-tight: -0.01em;

  /* size / line-height — the CRM's denser scale (owner call 2026-08), no longer pinned to
     Tailwind's numeric text-* steps; inputs alone hold the 16px text-base floor */
  --bb-text-caption: 0.75rem;    --bb-leading-caption: 1.4;  /* 12px */
  --bb-text-label: 0.8125rem;    --bb-leading-label: 1.4;    /* 13px — buttons, pills, nav */
  --bb-text-body: 0.875rem;      --bb-leading-body: 1.45;    /* 14px */
  --bb-text-heading-sm: 1rem;    --bb-leading-heading-sm: 1.35; /* 16px — dialog & section titles */
  --bb-text-heading-md: 1.375rem; --bb-leading-heading-md: 1.25; /* 22px — detail titles */
  --bb-text-heading-lg: 1.625rem; --bb-leading-heading-lg: 1.2;  /* 26px — page h1 */
  --bb-text-display: 1.75rem;    --bb-leading-display: 1.15;    /* 28px — hero/auth headline */
}

@theme inline {
  /* repoint shadcn/Tailwind's sans family at the brand stack */
  --font-sans: var(--bb-font-sans);

  /* named type roles (text-body, text-heading-lg, text-display, …) with coupled
     line-heights. The scale is the CRM's denser one, so the named roles deliberately
     diverge from Tailwind's numeric text-sm/base/lg steps — components reach for the
     roles; numeric utilities keep their stock sizes (inputs lean on text-base's 16px).
     The heading roles also carry the tight tracking, so no component needs a tracking
     class of its own. */
  --text-caption: var(--bb-text-caption);
  --text-caption--line-height: var(--bb-leading-caption);
  --text-label: var(--bb-text-label);
  --text-label--line-height: var(--bb-leading-label);
  --text-body: var(--bb-text-body);
  --text-body--line-height: var(--bb-leading-body);
  --text-heading-sm: var(--bb-text-heading-sm);
  --text-heading-sm--line-height: var(--bb-leading-heading-sm);
  --text-heading-md: var(--bb-text-heading-md);
  --text-heading-md--line-height: var(--bb-leading-heading-md);
  --text-heading-md--letter-spacing: var(--bb-tracking-tight);
  --text-heading-lg: var(--bb-text-heading-lg);
  --text-heading-lg--line-height: var(--bb-leading-heading-lg);
  --text-heading-lg--letter-spacing: var(--bb-tracking-tight);
  --text-display: var(--bb-text-display);
  --text-display--line-height: var(--bb-leading-display);
  --text-display--letter-spacing: var(--bb-tracking-tight);
}
```

Weights use Tailwind's standard font-* utilities (font-normal 400, font-medium 500, font-semibold
600, font-bold 700, font-extrabold 800; font-light 300 for the reserved case), so no weight
utilities are generated. Tracking rides the heading role utilities alone (−0.01em via
--bb-tracking-tight; no standalone letter-spacing utility is applied anywhere else), and
font-variant-numeric: tabular-nums is set on numeric contexts in component styles rather than as a
global rule.
