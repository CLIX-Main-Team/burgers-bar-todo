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
variants #BA9666/#5F4B32 corrected to the palette values). It appears on identity surfaces only —
the pre-auth brand panel and cap, the side-nav mark tile, and the app icon — and never backs dense
UI or running text.

Three consequences for the functional hues:

- Warning stays a burnt orange, deliberately pushed off the gradient's tan toward red-orange, so
  the brand's warm metals and "something needs attention" never read as the same colour.
- There is still no dedicated info colour. Blue now exists, but it means interaction, not
  information — an informational blue chip would read as a control. Info stays on the neutral
  muted surface and muted-foreground, and shadcn defines no info role in any case.
- Success stays an earthy olive green and danger a brick red — both warm-leaning so they sit
  inside the brown-and-cream family rather than reading as generic system colours.

Dark mode stays warm rather than inverted: the canvas is the chocolate darkened to near-black
(#1B150E and its steps — the same single hue, shaded, not a neutral slate), type lifts to the
brand cream, and the same blue carries the primary so light and dark share one interaction
language. It is designed with the same care as light, not derived by flipping it.

### Tier 1 — brand primitives

Drawn from the brand site's front page (2026-08 revision); derived steps are interpolations of
those brand values, kept warm.

Neutral poles: --bb-white #FFFFFF and --bb-black #000000 (the brand's text black).

Brown, the one brand brown and its shades: --bb-brown #5F4A32 (the chocolate — the palette's only
standalone brown), then its darkened steps for the dark theme: --bb-brown-600 #4E3D29 (dark
input border), --bb-brown-750 #3B2E1F (dark hairline), --bb-brown-800 #33281B (dark recessed
surface), --bb-brown-900 #261E14 (dark card), --bb-brown-950 #1B150E (dark canvas).

The gradient: --bb-tan #B99666 is the light stop of --bb-gradient-brand,
linear-gradient(90deg, tan → chocolate) — the site's header sweep. The tan is gradient-only,
never a standalone fill.

Cream, the warm paper neutrals: --bb-cream #FEF3E3 (the brand cream, the light canvas), and its
mixed-toward-brown steps --bb-cream-150 #F1E6D5 (recessed surface), --bb-cream-300 #E1D5C3
(hairline), --bb-cream-400 #D2C4B1 (input border; the dark theme's muted ink).

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

- background — the app canvas. Light --bb-cream; dark --bb-brown-950.
- foreground — default text and icons on the canvas. Light --bb-black; dark --bb-cream.
- card, popover — raised surfaces. Light --bb-white; dark --bb-brown-900. Their -foreground
  matches foreground (black / cream).
- muted — a recessed surface for secondary rows, disabled fills, and info-level chips. Light
  --bb-cream-150; dark --bb-brown-800.
- muted-foreground — secondary and metadata text; also the ink of neutral info chips. Light
  --bb-brown (the one brown, as the app's second voice); dark --bb-cream-400.
- border — hairlines and dividers. Light --bb-cream-300; dark --bb-brown-750.
- input — form-control borders. Light --bb-cream-400; dark --bb-brown-600.

Brand and action:

- primary — the primary action fill. Light and dark both --bb-blue-500.
- primary-foreground — text and icons on primary. Light and dark both --bb-white — the brand
  site's own pairing on its order button.
- secondary — the quiet, non-primary button and surface. Light --bb-cream-150; dark
  --bb-brown-800.
- secondary-foreground — text on secondary. Light --bb-brown; dark --bb-cream-150.
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
- success-foreground — text on success. Light --bb-white; dark --bb-brown-950.
- warning — attention fills. Light --bb-orange-600; dark --bb-orange-300.
- warning-foreground — text on warning. Light --bb-white; dark --bb-black.

There is deliberately no info, chart, or sidebar token in this set. Info folds into muted (above);
chart and sidebar families are added later only if a v1 surface needs them, per the theming
research.

### Soft status variants

Chips, badges, and toasts use a tinted surface with darker ink rather than the solid status fill,
which keeps small status text comfortably above 4.5:1 in both themes. They are peer tokens
(--<status> and --<status>-muted with a matching -foreground):

- success soft — light surface #E7EFD9 with ink #3C5A2C; dark surface --bb (ink) #26301B with ink
  #A9C98C.
- warning soft — light surface #F8E2C2 with ink #7C4A0C; dark surface #3A2A11 with ink #EBB363.
- destructive soft — light surface #F6DCD6 with ink #8C2C1E; dark surface #3A211B with ink #EB9384.
- info / neutral soft — the muted surface with muted-foreground; no dedicated hue.

### Accessibility conformance

Every pairing is measured against the WCAG 2.2 AA bar set in principles.md. Body foreground on
the canvas is about 19:1 light and 16:1 dark. The brown as muted-foreground clears 7.5:1 on the
cream canvas and 6.8:1 on the recessed surface; the dark theme's muted ink clears 8:1. Accent ink
is about 5.2:1 on the pale-blue surface light and 6.5:1 dark. White on the brand blue is the one
knowing trade-off: about 4.1:1 — above the 3:1 large-text and non-text bars, marginally under the
4.5:1 small-text bar. It is the brand site's own pairing on its order button; button labels ride
the 48px control, and any running blue text uses the deeper --bb-blue-600 (about 5.4:1 on cream)
instead. Small status text always uses the soft variants above rather than the solid fill; the
solid success and warning fills keep their darkened values (#46703B, #9E5A0E) so white labels
pass 4.5:1. The focus ring (brand blue) clears 3:1 against canvas, card, and the dark canvas. The
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
  --bb-brown: #5F4A32;     --bb-brown-600: #4E3D29; --bb-brown-750: #3B2E1F;
  --bb-brown-800: #33281B; --bb-brown-900: #261E14; --bb-brown-950: #1B150E;
  --bb-tan: #B99666;
  --bb-gradient-brand: linear-gradient(90deg, var(--bb-tan) 0%, var(--bb-brown) 100%);
  --bb-cream: #FEF3E3;     --bb-cream-150: #F1E6D5;
  --bb-cream-300: #E1D5C3; --bb-cream-400: #D2C4B1;
  --bb-blue-100: #EAF2FC;  --bb-blue-300: #7FB0EE;  --bb-blue-500: #297DE1;
  --bb-blue-600: #1E64B6;  --bb-blue-950: #16293F;
  --bb-green-300: #86B86F; --bb-green-600: #46703B;
  --bb-orange-300: #EBB363; --bb-orange-600: #9E5A0E;
  --bb-red-400: #E0705C;   --bb-red-600: #B23A2B;   --bb-red-950: #241010;

  /* Tier 2 — semantic (light) */
  --background: var(--bb-cream);           --foreground: var(--bb-black);
  --card: var(--bb-white);                 --card-foreground: var(--bb-black);
  --popover: var(--bb-white);              --popover-foreground: var(--bb-black);
  --primary: var(--bb-blue-500);           --primary-foreground: var(--bb-white);
  --secondary: var(--bb-cream-150);        --secondary-foreground: var(--bb-brown);
  --muted: var(--bb-cream-150);            --muted-foreground: var(--bb-brown);
  --accent: var(--bb-blue-100);            --accent-foreground: var(--bb-blue-600);
  --destructive: var(--bb-red-600);        --destructive-foreground: var(--bb-white);
  --success: var(--bb-green-600);          --success-foreground: var(--bb-white);
  --warning: var(--bb-orange-600);         --warning-foreground: var(--bb-white);
  --border: var(--bb-cream-300);           --input: var(--bb-cream-400);
  --ring: var(--bb-blue-500);

  /* soft status variants */
  --success-muted: #E7EFD9;    --success-muted-foreground: #3C5A2C;
  --warning-muted: #F8E2C2;    --warning-muted-foreground: #7C4A0C;
  --destructive-muted: #F6DCD6; --destructive-muted-foreground: #8C2C1E;
}

.dark {
  color-scheme: dark;
  --background: var(--bb-brown-950);       --foreground: var(--bb-cream);
  --card: var(--bb-brown-900);             --card-foreground: var(--bb-cream);
  --popover: var(--bb-brown-900);          --popover-foreground: var(--bb-cream);
  --primary: var(--bb-blue-500);           --primary-foreground: var(--bb-white);
  --secondary: var(--bb-brown-800);        --secondary-foreground: var(--bb-cream-150);
  --muted: var(--bb-brown-800);            --muted-foreground: var(--bb-cream-400);
  --accent: var(--bb-blue-950);            --accent-foreground: var(--bb-blue-300);
  --destructive: var(--bb-red-400);        --destructive-foreground: var(--bb-red-950);
  --success: var(--bb-green-300);          --success-foreground: var(--bb-brown-950);
  --warning: var(--bb-orange-300);         --warning-foreground: var(--bb-black);
  --border: var(--bb-brown-750);           --input: var(--bb-brown-600);
  --ring: var(--bb-blue-500);

  --success-muted: #26301B;    --success-muted-foreground: #A9C98C;
  --warning-muted: #3A2A11;    --warning-muted-foreground: #EBB363;
  --destructive-muted: #3A211B; --destructive-muted-foreground: #EB9384;
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
lighter (card is ink-900 over the ink-950 canvas, from the colour section) — because shadows barely
register on dark grounds. The shadow steps are kept but softened under .dark, present only enough to
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
humanist sans that carries both scripts in one family (ticket #67); its character comes from weight
and warmth, not from mixing faces. The staff app does not hold a SimplerPro licence and fonts are
free-only (standing directive, ticket #66), so the licensed file is replaced — not paired against —
by Assistant, a freely-licensable humanist sans that likewise covers Hebrew and Latin in one family
and is the closest free match to SimplerPro's warm, homegrown register. There is deliberately no
second display face and no separate Latin companion: the same family sets Hebrew and English, and
the single-family decision from the brand research is preserved. One --bb-font-sans token carries
it; there is no serif and no mono family, because nothing in v1 renders code — a mono token is added
later only if a surface needs one.

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
a comfortable size), never as running body, label, or any interactive text.

The scale is one fixed, mobile-first scale, aligned to Tailwind's built-in type steps the same way
the layout tokens align to its numeric scale — so a named role and a Tailwind text-* utility never
disagree, and the retheme stays honest with no parallel scale to keep in sync. There are no
responsive or fluid type bumps: the app is one single-column, phone-capped layout (--bb-content-max
30rem, from the layout section), so the desktop view is the phone scale centred, and one scale
serves every viewport. The body floor is 16px, which is also the threshold below which iOS
auto-zooms a focused input, so form fields never drop under it; nothing interactive goes below 14px,
and 12px is reserved for genuinely secondary metadata.

The rules that make the system Hebrew-first rather than a Latin scale with Hebrew poured in:

- Tracking is normal (0) on every role. No letter-spacing is applied, and display headings are not
  given the slight negative tracking Latin practice would use — this is one family serving
  RTL-canonical Hebrew, and letter-spacing Hebrew is actively harmful because it is not a spaced
  script. One family and one direction-native rule mean Latin is not special-cased.
- There is no uppercase label style. Hebrew has no letter case, so text-transform: uppercase does
  nothing to Hebrew and would make the Hebrew and English UIs diverge; labels get their presence
  from weight 500 and size, never from casing.
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
and should not fetch a font from a third party on every launch, so Assistant ships inside the app
bundle. Assistant is a variable font with a weight axis, so a single file covers the whole 300–800
range rather than shipping five static weights; the standard self-host route is the
@fontsource-variable/assistant package, loading the Hebrew and Latin subsets. font-display is swap,
so text renders immediately in the fallback and swaps when Assistant loads, which is acceptable
because the fallback stack is a close metric match and resolves to a Hebrew-capable UI font on every
target OS. Naming the approach and the tokens is this section's job; the actual @fontsource install
and @font-face wiring is build hand-off work, out of scope for this planning map, the same way the
colour and layout sections stop at reference CSS.

### Tier 1 — type primitives

The family stack, the weights in use, and the size/line-height scale as raw --bb-* values.

Family: --bb-font-sans is the stack 'Assistant', system-ui, -apple-system, 'Segoe UI', 'Noto Sans
Hebrew', Arial, sans-serif. Assistant is the brand face; system-ui and the following entries are the
fallback shown until it loads and the safety net if it fails, ordered so RTL never falls back to a
Latin-only face.

Weights, the five in use plus the reserved light: --bb-weight-light 300 (reserved: large
non-critical display only), --bb-weight-regular 400, --bb-weight-medium 500, --bb-weight-semibold
600, --bb-weight-bold 700, --bb-weight-heavy 800. These line up one-to-one with Tailwind's
font-light / font-normal / font-medium / font-semibold / font-bold / font-extrabold utilities, so a
component can name the weight either way.

Size and line-height, each role a size paired with a line-height, aligned to Tailwind's default
text-* steps:

- caption — 0.75rem (12px), line-height 1.4. Tailwind text-xs.
- label / body-sm — 0.875rem (14px), line-height 1.4. Tailwind text-sm.
- body — 1rem (16px), line-height 1.5. Tailwind text-base. The interactive and input floor.
- heading-sm — 1.125rem (18px), line-height 1.35. Tailwind text-lg.
- heading-md — 1.25rem (20px), line-height 1.3. Tailwind text-xl.
- heading-lg — 1.5rem (24px), line-height 1.25. Tailwind text-2xl.
- display — 1.875rem (30px), line-height 1.15. Tailwind text-3xl.

### Tier 2 — semantic roles

Each named role is a size, a weight, and the intent it carries. Roles reference the primitives
above; none vary by theme.

- display — display size, weight 700 to 800 (heavy). Hero, onboarding, big numbers. The one role
  where the reserved 300 light is also allowed, as a deliberate large-light variant.
- heading-lg, heading-md, heading-sm — their matching sizes, all weight 600 (semibold). The heading
  ladder is differentiated by size, not weight, matching SimplerPro's 600 heading weight; think h1,
  h2, h3.
- body — body size, weight 400. Default running text.
- body-emphasis — body size, weight 600. Inline emphasis and links within body text.
- label — label size, weight 500 (medium). Buttons, form labels, navigation — heavier than body so
  controls read as controls, never uppercased.
- caption — caption size, weight 400. Metadata and timestamps; its de-emphasis is carried by size
  and the muted-foreground colour from the colour section, not by a lighter weight.

### Accessibility conformance

The type meets the WCAG 2.2 AA bar set in principles.md. Body and all interactive text is weight 400
or heavier at 16px or larger, well clear of the thin-stroke legibility problem that pushed body off
weight 300; weight 300 appears only as large, non-critical display. Nothing interactive renders
below 14px and body inputs hold at 16px, above the size at which small controls become hard to hit
or trigger mobile auto-zoom. Colour contrast is settled in the colour section — foreground on the
canvas clears 12:1 in both themes and muted-foreground clears 4.5:1 — and this section adds no
pairing that undercuts it. Generous line-heights and normal tracking keep Hebrew and Latin running
text comfortable to read.

### Reference CSS

The typography tokens as they extend apps/web/src/index.css, added to the same blocks the colour and
layout systems use. Type values do not vary by theme, so they are declared once in :root; the
@theme inline block maps the family and the named roles to utilities. Loading the Assistant font
files (the @font-face rules from @fontsource-variable/assistant) is build hand-off work and is not
shown here.

```css
:root {
  /* Tier 1 — type primitives */
  --bb-font-sans: 'Assistant', system-ui, -apple-system, 'Segoe UI', 'Noto Sans Hebrew', Arial, sans-serif;

  --bb-weight-light: 300;   /* reserved: large non-critical display only */
  --bb-weight-regular: 400; --bb-weight-medium: 500;   --bb-weight-semibold: 600;
  --bb-weight-bold: 700;    --bb-weight-heavy: 800;

  /* size / line-height, aligned to Tailwind's text-* steps */
  --bb-text-caption: 0.75rem;     --bb-leading-caption: 1.4;
  --bb-text-label: 0.875rem;      --bb-leading-label: 1.4;
  --bb-text-body: 1rem;           --bb-leading-body: 1.5;
  --bb-text-heading-sm: 1.125rem; --bb-leading-heading-sm: 1.35;
  --bb-text-heading-md: 1.25rem;  --bb-leading-heading-md: 1.3;
  --bb-text-heading-lg: 1.5rem;   --bb-leading-heading-lg: 1.25;
  --bb-text-display: 1.875rem;    --bb-leading-display: 1.15;
}

@theme inline {
  /* repoint shadcn/Tailwind's sans family at the brand stack */
  --font-sans: var(--bb-font-sans);

  /* named type roles (text-body, text-heading-lg, text-display, …) with coupled
     line-heights; Tailwind's numeric text-base/text-lg/… still resolve to the same
     sizes, so both forms name one value, as in the layout section */
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
  --text-heading-lg: var(--bb-text-heading-lg);
  --text-heading-lg--line-height: var(--bb-leading-heading-lg);
  --text-display: var(--bb-text-display);
  --text-display--line-height: var(--bb-leading-display);
}
```

Weights use Tailwind's standard font-* utilities (font-normal 400, font-medium 500, font-semibold
600, font-bold 700, font-extrabold 800; font-light 300 for the reserved case), so no weight
utilities are generated. Tracking stays at the browser default (no letter-spacing utility is
applied), and font-variant-numeric: tabular-nums is set on numeric contexts in component styles
rather than as a global rule.
