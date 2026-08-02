# Design tokens

The token layer of the Burgers Bar staff-app design system: the named values every component
draws from, with light and dark defined from the start. This document is assembled across the
token tickets, one section per decision. The colour system is decided here (ticket #70); the
typography pairing and type scale (ticket #71) and the spacing, radius, elevation, breakpoint,
and touch-target tokens (ticket #72) are appended to this file as those tickets close.

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

Gold leads. The brand's hero colour — the bright appetite-gold #F4A81D — carries the primary
action, painted with dark ink rather than white, which is the pairing the principles accessibility
note calls for and which clears contrast comfortably (about 9:1). Gold is spent on one primary
action per screen, in keeping with the calm, one-primary-action density principle; warm charcoal
and cream do all the neutral work around it.

The palette stays strictly warm, with no blue anywhere. The blue seen on the live site was an
Elementor default, not a brand choice (ticket #67), and is not adopted. Three consequences follow:

- Warning is a burnt orange, deliberately pushed off gold toward red-orange, so brand emphasis and
  "something needs attention" never read as the same colour. Were warning left as amber it would
  collide with the primary, and the discipline that makes gold meaningful would be lost.
- There is no dedicated info colour. Informational, low-stakes states use the neutral muted surface
  and muted-foreground. Success and danger carry the real signal; introducing a cool info hue would
  break the no-blue promise for the least critical status, and shadcn does not define an info role
  in any case.
- Success is an earthy olive green and danger a brick red — both warm-leaning so they sit inside the
  earth-tone family rather than reading as generic system colours.

Dark mode is close to the brand's native home rather than an inversion. The brand already lives as
gold and white on black, so the dark theme grounds on a warm near-black (a brown-biased #15110A,
not a neutral slate), keeps the same gold primary, and lifts type to a warm cream. It is designed
with the same care as light, not derived by flipping it.

### Tier 1 — brand primitives

Drawn from the extracted brand palette (ticket #67); derived steps are interpolations of those
brand values, kept warm.

Neutral white: --bb-white #FFFFFF.

Gold, the hero hue: --bb-gold-100 #FBE6C4 (pale gold surface), --bb-gold-200 #F0C877,
--bb-gold-400 #F4A81D (the brand appetite-gold), --bb-gold-700 #A2680A (bronze, for the light-theme
focus ring), --bb-gold-800 #7C4A0C (ink for text on a pale gold surface), --bb-gold-950 #3A2C10
(deep gold, the dark-theme accent surface).

Cream, the warm paper neutrals: --bb-cream-50 #FBF6EC, --bb-cream-100 #F1E7D5, --bb-cream-150
#E8D9BF, --bb-cream-200 #E9DCC7, --bb-cream-300 #E0D0B8, --bb-cream-400 #C9B48F.

Clay, the mid warm-neutral browns: --bb-clay-300 #AD9E82, --bb-clay-500 #77664F, --bb-clay-800
#3A2E1C.

Ink, the warm near-blacks: --bb-ink-700 #43351F, --bb-ink-750 #352A1B, --bb-ink-800 #2A2216,
--bb-ink-850 #211A11, --bb-ink-900 #1F1910, --bb-ink-950 #15110A, --bb-ink-max #23180A (the dark
ink that sits on gold).

Functional hues, warm-leaning: green --bb-green-300 #86B86F and --bb-green-600 #46703B; orange
--bb-orange-300 #EBB363 and --bb-orange-600 #9E5A0E; red --bb-red-400 #E0705C, --bb-red-600
#B23A2B, and --bb-red-950 #241010 (ink for text on the light-red dark-theme fill).

### Tier 2 — semantic tokens

Each role is given as: what it is for, then its light value and its dark value, named by primitive.

Surfaces and ink:

- background — the app canvas. Light --bb-cream-50; dark --bb-ink-950.
- foreground — default text and icons on the canvas. Light --bb-ink-850; dark --bb-cream-100.
- card, popover — raised surfaces. Light --bb-white; dark --bb-ink-900. Their -foreground matches
  foreground (ink-850 / cream-100).
- muted — a recessed surface for secondary rows, disabled fills, and info-level chips. Light
  --bb-cream-100; dark --bb-ink-800.
- muted-foreground — secondary and metadata text; also the ink of neutral info chips. Light
  --bb-clay-500; dark --bb-clay-300.
- border — hairlines and dividers. Light --bb-cream-200; dark --bb-ink-750.
- input — form-control borders. Light --bb-cream-300; dark --bb-ink-700.

Brand and action:

- primary — the primary action fill. Light and dark both --bb-gold-400.
- primary-foreground — text and icons on primary. Light and dark both --bb-ink-max (dark ink on
  gold, never white).
- secondary — the quiet, non-primary button and surface. Light --bb-cream-100; dark --bb-ink-800.
- secondary-foreground — text on secondary. Light --bb-clay-800; dark --bb-cream-150.
- accent — a soft highlight surface for hover and selected states. Light --bb-gold-100; dark
  --bb-gold-950.
- accent-foreground — ink on the accent surface, and the assistant's emphasis/link colour. Light
  --bb-gold-800; dark --bb-gold-200.
- ring — the focus indicator. Light --bb-gold-700 (bronze, so the ring clears 3:1 on cream); dark
  --bb-gold-400.

Status:

- destructive — danger fills and destructive actions. Light --bb-red-600; dark --bb-red-400.
- destructive-foreground — text on destructive. Light --bb-white; dark --bb-red-950.
- success — confirmation fills. Light --bb-green-600; dark --bb-green-300.
- success-foreground — text on success. Light --bb-white; dark --bb-ink-950.
- warning — attention fills. Light --bb-orange-600; dark --bb-orange-300.
- warning-foreground — text on warning. Light --bb-white; dark --bb-ink-max.

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

Every pairing meets the WCAG 2.2 AA bar set in principles.md. Dark ink on gold is about 9:1. Body
foreground on the canvas is above 12:1 in both themes. Muted-foreground on the canvas clears 4.5:1
(about 5:1 light, higher in dark). The solid success and warning fills were nudged darker
(#46703B and #9E5A0E) specifically so white label text passes 4.5:1; all solid status fills clear
about 5:1 with their foreground. Small status text always uses the soft variants above rather than
the solid fill. The focus ring clears 3:1 against its surface in both themes (bronze on light, gold
on dark). No brand colour is used as body text below its contrast floor; the mid-tone antique golds
appear only as fills or large accents, never as running text.

### Reference CSS

The whole colour system as it drops into apps/web/src/index.css. This is the implementable form of
everything above; the build feature that wires the theme (out of scope for this map) starts here.

```css
@custom-variant dark (&:where(.dark, .dark *));

:root {
  color-scheme: light;

  /* Tier 1 — brand primitives (not in @theme; never used directly) */
  --bb-white: #FFFFFF;
  --bb-gold-100: #FBE6C4;  --bb-gold-200: #F0C877;  --bb-gold-400: #F4A81D;
  --bb-gold-700: #A2680A;  --bb-gold-800: #7C4A0C;  --bb-gold-950: #3A2C10;
  --bb-cream-50: #FBF6EC;  --bb-cream-100: #F1E7D5; --bb-cream-150: #E8D9BF;
  --bb-cream-200: #E9DCC7; --bb-cream-300: #E0D0B8; --bb-cream-400: #C9B48F;
  --bb-clay-300: #AD9E82;  --bb-clay-500: #77664F;  --bb-clay-800: #3A2E1C;
  --bb-ink-700: #43351F;   --bb-ink-750: #352A1B;   --bb-ink-800: #2A2216;
  --bb-ink-850: #211A11;   --bb-ink-900: #1F1910;   --bb-ink-950: #15110A;
  --bb-ink-max: #23180A;
  --bb-green-300: #86B86F; --bb-green-600: #46703B;
  --bb-orange-300: #EBB363; --bb-orange-600: #9E5A0E;
  --bb-red-400: #E0705C;   --bb-red-600: #B23A2B;   --bb-red-950: #241010;

  /* Tier 2 — semantic (light) */
  --background: var(--bb-cream-50);        --foreground: var(--bb-ink-850);
  --card: var(--bb-white);                 --card-foreground: var(--bb-ink-850);
  --popover: var(--bb-white);              --popover-foreground: var(--bb-ink-850);
  --primary: var(--bb-gold-400);           --primary-foreground: var(--bb-ink-max);
  --secondary: var(--bb-cream-100);        --secondary-foreground: var(--bb-clay-800);
  --muted: var(--bb-cream-100);            --muted-foreground: var(--bb-clay-500);
  --accent: var(--bb-gold-100);            --accent-foreground: var(--bb-gold-800);
  --destructive: var(--bb-red-600);        --destructive-foreground: var(--bb-white);
  --success: var(--bb-green-600);          --success-foreground: var(--bb-white);
  --warning: var(--bb-orange-600);         --warning-foreground: var(--bb-white);
  --border: var(--bb-cream-200);           --input: var(--bb-cream-300);
  --ring: var(--bb-gold-700);

  /* soft status variants */
  --success-muted: #E7EFD9;    --success-muted-foreground: #3C5A2C;
  --warning-muted: #F8E2C2;    --warning-muted-foreground: #7C4A0C;
  --destructive-muted: #F6DCD6; --destructive-muted-foreground: #8C2C1E;
}

.dark {
  color-scheme: dark;
  --background: var(--bb-ink-950);         --foreground: var(--bb-cream-100);
  --card: var(--bb-ink-900);               --card-foreground: var(--bb-cream-100);
  --popover: var(--bb-ink-900);            --popover-foreground: var(--bb-cream-100);
  --primary: var(--bb-gold-400);           --primary-foreground: var(--bb-ink-max);
  --secondary: var(--bb-ink-800);          --secondary-foreground: var(--bb-cream-150);
  --muted: var(--bb-ink-800);              --muted-foreground: var(--bb-clay-300);
  --accent: var(--bb-gold-950);            --accent-foreground: var(--bb-gold-200);
  --destructive: var(--bb-red-400);        --destructive-foreground: var(--bb-red-950);
  --success: var(--bb-green-300);          --success-foreground: var(--bb-ink-950);
  --warning: var(--bb-orange-300);         --warning-foreground: var(--bb-ink-max);
  --border: var(--bb-ink-750);             --input: var(--bb-ink-700);
  --ring: var(--bb-gold-400);

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
