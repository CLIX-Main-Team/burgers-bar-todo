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

The 2026-08-12 design refresh (owner-led, the professional brand pass — PR #289, merged and live
2026-08-13) re-grounds the whole colour system on the client's own brand book (Colors.pdf at the
repo root): Black, White, the Gold Gradient, Pantone 4242 C (the camel gold), Warm Gray 1 C (the
warm off-white behind the neutral ramp), and Pantone 2727 C (the blue the site ships as #297DE1).
It supersedes the 2026-08 blue-led revision wherever the two disagree; that revision's history is
kept at the end of this section. Two theses carry everything:

**Day speaks black; night speaks gold.** The light theme's primary action is the brand ink itself
— --bb-ink #1B1917, brand black one step off #000, on the warm-paper canvas — and the dark theme
hands the same role to the camel gold #C9A063 on warm char, with a near-black gold-cast ink
(#17130D) riding on it. Night is a second setting, not an inversion: the canvas is warm char, the
ink warm white, and the lead flips. Blue is demoted from identity to worker: it survives only as
--link (inline links and link-buttons — the one place blue still speaks by itself) and as the
in-progress status hue, and never fills a primary control again.

**The gold is a thread, not a paint.** The accent pair is a warm gold wash with gold-as-text ink
(#F2ECDF/#6C5434 light, #2E2717/#C9A063 dark) — active pills, avatar fallbacks, quiet hovers.
--ring makes focus the gold halo in both themes, and a direct --gold utility carries the small
selection marks: the selected status tab's underline, the tab bar's active dot, the side nav's
and thread rail's inline-start markers. Rationing is what keeps it premium.

The gradient is the brand book's real gold sweep — linear-gradient(135deg, #C9A063 0%, #8C7449
55%, #6C5434 100%) — replacing the old tan→chocolate guess. Hero moments only: the pre-auth
panel and phone hero wear it; the working screens never do.

**The side nav is brand black in both themes** (the menu board on the wall — the refresh's one
declared aesthetic risk). Its surface and inks are fixed --bb-nav-* primitives rather than
semantic tokens — surface #17140F, border #2E2921, ink #F2EFE9, muted #AAA294, and the gold at
13% opacity for the active-row wash — so day and night stand the app on the same black anchor
with the gold marking where you are.

**Status stops being pastel.** A status marks itself with a small dot beside neutral ink
(STATUS_DOT in board-columns.ts) — colour spent only where it means something. The tinted pill
surfaces are gone; each status owns a dot colour plus an ink for the few places the status word
itself is coloured (the completed date line). Lane heads, the mobile status tabs, and the card's
StatusControl chip all read the one dot map.

**Three boundary strengths** (2026-08-13, the replica density pass): --border draws hairlines and
dividers; --border-strong wraps chips, icon buttons, and outline pills — lighter than an input's
line, firmer than the hairline; --input keeps the firmest boundary on true text fields, holding
the 3:1 control-boundary rule. A --border-strong control always carries a second affordance
(label, dot, glyph), so the softer line is presentation, not the control's only edge.

The neutral ramp is re-warmed onto the Warm Gray 1 C family — warm paper #F4F2EC as the light
canvas, warm char #131110 as the dark one, stopping short of pure black so a card still reads as
a lighter surface above the ground. One family carries both themes, which is what keeps the gold
from reading as a stray against a colder grey. The functional hues (success, warning,
destructive, and the soft pairs) carry over from the earlier revisions unchanged, warm-leaning so
they sit inside the family. There is still no dedicated info colour — info stays on the muted
surface and muted-foreground.

App icons: every home-screen tile — Android launcher, PWA, apple-touch — is the dark canvas
carrying the bare ( B ) mark, so the icon you tap is the two colours of the screen it opens; the
browser tab alone ships the site's own favicon verbatim (owner calls 2026-08). The manifest and
theme-color chrome follow the refresh's canvases: #F4F2EC by day, #131110 pre-paint dark.

Superseded history, kept for the paper trail: the 2026-08 revision centred the app on the site's
front page as then read — blue #297DE1 primary, one chocolate brown #5F4A32, cream #FEF3E3, a
90deg tan→chocolate gradient; the 2026-08-11 revision made dark mode neutral (it had read as
sepia) and moved input borders onto the 400/500 control-boundary steps; the 2026-08 neutral
revision took the light canvas off cream onto the CRM's warm near-whites. The refresh keeps those
structural lessons — the neutral-ramp architecture, the control-boundary rule, dark-as-designed —
and repoints the identity from blue-and-brown to black-and-gold.

### Tier 1 — brand primitives

Drawn from the client's brand book (2026-08-12 refresh); derived steps are interpolations kept
warm.

Neutral poles: --bb-white #FFFFFF and --bb-black #000000.

The ink: --bb-ink #1B1917 — brand black one step off #000: the light theme's text AND its
primary action fill (the refresh's thesis: day speaks black on warm paper).

The gold ramp — Pantone 4242 C at 500, the brand gradient's light and deep stops at 300 and 700:
--bb-gold-300 #C9A063 (night's primary fill — gold speaks after close), --bb-gold-500 #8C7449
(day's focus ring and gold utility), --bb-gold-700 #6C5434 (gold as small text on a light
surface — 7:1 on white).

The gradient: --bb-gradient-brand is linear-gradient(135deg, gold-300 0%, gold-500 55%,
gold-700 100%) — the brand book's own sweep. Hero moments only; never behind dense UI.

Cream: --bb-cream #FEF3E3 — the baked fill of the pre-auth wordmark/bracket SVG artwork, kept as
the one named reference to that colour. Not a surface or an ink anywhere.

The fixed chrome: --bb-nav-surface #17140F, --bb-nav-border #2E2921, --bb-nav-ink #F2EFE9,
--bb-nav-muted #AAA294, --bb-nav-active rgb(201 160 99 / 0.13) — the desktop side nav's brand
black, theme-independent by design.

Neutrals, re-grounded on Warm Gray 1 C: --bb-neutral-50 #F4F2EC (warm paper, the light canvas
and the dark ink), --bb-neutral-100 #ECE9E1 (light recessed surface), --bb-neutral-200 #E0DCD2
(light hairline), --bb-neutral-300 #BFB9AC (light border-strong), --bb-neutral-400 #97907F
(light input border), --bb-neutral-500 #6E6759 (dark input border), --bb-neutral-600 #5C5850
(light muted ink), --bb-neutral-700 #4D463A (dark border-strong, added 2026-08-13),
--bb-neutral-800 #3A342B (dark hairline), --bb-neutral-850 #2A251E (dark recessed surface),
--bb-neutral-900 #1E1B17 (dark card), --bb-neutral-950 #131110 (warm char, the dark canvas).

The 400 and 500 steps remain the control-boundary pair (2026-08-11 rule, values re-warmed): the
lightest and darkest values that still clear the 3:1 non-text bar for a control boundary on
their own theme's card. The 300/700 pair added 2026-08-13 is the deliberately softer
border-strong step for controls that carry a second affordance.

Blue, the working hue (Pantone 2727 C): --bb-blue-100 #EAF2FC, --bb-blue-300 #7FB0EE (dark
link), --bb-blue-500 #297DE1, --bb-blue-600 #1E64B6 (light link), --bb-blue-950 #16293F.

Functional hues, warm-leaning: green --bb-green-300 #86B86F and --bb-green-600 #46703B; orange
--bb-orange-300 #EBB363 and --bb-orange-600 #9E5A0E; red --bb-red-400 #E0705C, --bb-red-600
#B23A2B, and --bb-red-950 #241010 (ink for text on the light-red dark-theme fill).

### Tier 2 — semantic tokens

Each role is given as: what it is for, then its light value and its dark value, named by primitive.

Surfaces and ink:

- background — the app canvas. Light --bb-neutral-50 (warm paper); dark --bb-neutral-950 (warm
  char).
- foreground — default text and icons on the canvas. Light --bb-ink; dark --bb-neutral-50.
- card, popover — raised surfaces. Light --bb-white; dark --bb-neutral-900. Their -foreground
  matches foreground (ink / near-white).
- muted — a recessed surface for secondary rows, disabled fills, and info-level chips. Light
  --bb-neutral-100; dark --bb-neutral-850.
- muted-foreground — secondary and metadata text; also the ink of neutral info chips. Light
  --bb-neutral-600; dark --bb-neutral-300.
- border — hairlines and dividers. Light --bb-neutral-200; dark --bb-neutral-800.
- border-strong — the mid boundary (2026-08-13): chips, icon buttons, outline pills. Light
  --bb-neutral-300; dark --bb-neutral-700. Softer than input by design; the control it wraps
  always carries a second affordance.
- input — text-field borders, the firmest line. Light --bb-neutral-400; dark --bb-neutral-500.
  Both clear 3:1 against their theme's card, so a field reads as a field before it is focused.

Brand and action:

- primary — the primary action fill. Light --bb-ink (day speaks black); dark --bb-gold-300
  (night speaks gold).
- primary-foreground — text and icons on primary. Light --bb-neutral-50; dark #17130D (a
  near-black with the gold's cast).
- secondary — the quiet, non-primary button and surface. Light --bb-neutral-100; dark
  --bb-neutral-850.
- secondary-foreground — text on secondary. Light --bb-neutral-800; dark --bb-neutral-200.
- accent — the gold thread's wash: active nav pills, avatar fallbacks, quiet hovers. Light
  #F2ECDF; dark #2E2717.
- accent-foreground — gold as ink on the accent surface (and gold text generally, e.g. the task
  card's branch signature). Light --bb-gold-700; dark --bb-gold-300.
- link — inline links and link-buttons, the one place blue speaks by itself. Light
  --bb-blue-600; dark --bb-blue-300.
- ring — the focus indicator, the gold halo in both themes. Light --bb-gold-500; dark
  --bb-gold-300.
- gold — gold as a direct utility for the small selection marks (tab underline, tab-bar dot,
  nav/rail markers). Light --bb-gold-500; dark --bb-gold-300.

The fixed nav inks (nav-surface, nav-border, nav-ink, nav-muted, nav-active, nav-gold =
--bb-gold-300) are bridged as utilities too, but they are Tier-1 primitives — the black side nav
does not follow the theme.

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

Task statuses are the dot system (2026-08-12 refresh, replacing the STATUS_TONE pill surfaces):
a status marks itself with a small dot beside neutral ink, so each status owns a dot colour plus
a foreground for the few places the status word itself is coloured (the completed date line).
Lane heads, the mobile status tabs, and the card's StatusControl chip all read the one
STATUS_DOT map in board-columns.ts; nothing paints a tinted status surface any more.

- status-not-started — dot #B07C10 light with ink #8A600E; dark both #E0A63C.
- status-in-progress — dot and ink #2F6DB5 light; dark both #6FA8E8.
- status-done — dot and ink #3F7A52 light; dark both #7FC496.

The dark dots brighten to hold at least 3:1 against the char canvas, and a dot never carries
meaning alone — the status label always sits beside it (no colour-only meaning, principles.md).

### Accessibility conformance

Every pairing is measured against the WCAG 2.2 AA bar set in principles.md. Body foreground on
the canvas clears roughly 15:1 in both themes (ink on paper, warm white on char). The primary
pairs both clear the small-text bar: paper-on-ink is near-maximal by day, and the gold-300 fill
with its #17130D ink clears about 8:1 by night. Gold as text uses the ramp's contrast-safe ends
— gold-700 on white is about 7:1, gold-300 on char about 7.5:1; gold-500 is never small text,
only the ring and the selection marks (non-text, 3:1 territory). The link blues clear 4.5:1 on
their canvases. Muted-foreground clears about 6:1 light and 9:1 dark. Status dots hold at least
3:1 against both canvases (the dark set brightens for exactly this), and the dot never carries
meaning alone. Input borders keep the 3:1 non-text bar on their own theme's card (the 400/500
control-boundary steps); border-strong sits below that bar by design and is allowed only where
the control carries a second affordance. On the fixed black nav, nav-ink clears about 12:1 and
nav-muted about 6:1 against the nav surface. Text on the gold gradient is the white/cream
wordmark at hero sizes only, never running text.

### Reference CSS

The whole colour system as it drops into apps/web/src/index.css. This is the implementable form of
everything above; the build feature that wires the theme (out of scope for this map) starts here.

```css
@custom-variant dark (&:where(.dark, .dark *));

:root {
  color-scheme: light;

  /* Tier 1 — brand primitives (not in @theme; never used directly) */
  --bb-white: #FFFFFF;     --bb-black: #000000;
  --bb-ink: #1B1917;
  --bb-gold-300: #C9A063;  --bb-gold-500: #8C7449;  --bb-gold-700: #6C5434;
  --bb-gradient-brand: linear-gradient(135deg,
    var(--bb-gold-300) 0%, var(--bb-gold-500) 55%, var(--bb-gold-700) 100%);
  --bb-cream: #FEF3E3;
  --bb-nav-surface: #17140F; --bb-nav-border: #2E2921; --bb-nav-ink: #F2EFE9;
  --bb-nav-muted: #AAA294;   --bb-nav-active: rgb(201 160 99 / 0.13);
  --bb-neutral-50: #F4F2EC;  --bb-neutral-100: #ECE9E1; --bb-neutral-200: #E0DCD2;
  --bb-neutral-300: #BFB9AC; --bb-neutral-400: #97907F; --bb-neutral-500: #6E6759;
  --bb-neutral-600: #5C5850; --bb-neutral-700: #4D463A;
  --bb-neutral-800: #3A342B; --bb-neutral-850: #2A251E; --bb-neutral-900: #1E1B17;
  --bb-neutral-950: #131110;
  --bb-blue-100: #EAF2FC;  --bb-blue-300: #7FB0EE;  --bb-blue-500: #297DE1;
  --bb-blue-600: #1E64B6;  --bb-blue-950: #16293F;
  --bb-green-300: #86B86F; --bb-green-600: #46703B;
  --bb-orange-300: #EBB363; --bb-orange-600: #9E5A0E;
  --bb-red-400: #E0705C;   --bb-red-600: #B23A2B;   --bb-red-950: #241010;

  /* Tier 2 — semantic (light): day speaks black on warm paper */
  --background: var(--bb-neutral-50);      --foreground: var(--bb-ink);
  --card: var(--bb-white);                 --card-foreground: var(--bb-ink);
  --popover: var(--bb-white);              --popover-foreground: var(--bb-ink);
  --primary: var(--bb-ink);                --primary-foreground: var(--bb-neutral-50);
  --secondary: var(--bb-neutral-100);      --secondary-foreground: var(--bb-neutral-800);
  --muted: var(--bb-neutral-100);          --muted-foreground: var(--bb-neutral-600);
  --accent: #F2ECDF;                       --accent-foreground: var(--bb-gold-700);
  --link: var(--bb-blue-600);
  --destructive: var(--bb-red-600);        --destructive-foreground: var(--bb-white);
  --success: var(--bb-green-600);          --success-foreground: var(--bb-white);
  --warning: var(--bb-orange-600);         --warning-foreground: var(--bb-white);
  --border: var(--bb-neutral-200);         --border-strong: var(--bb-neutral-300);
  --input: var(--bb-neutral-400);
  --ring: var(--bb-gold-500);              --gold: var(--bb-gold-500);

  /* soft status variants */
  --success-muted: #E4F3E9;    --success-muted-foreground: #2C7A4B;
  --warning-muted: #FBECDB;    --warning-muted-foreground: #A05A10;
  --destructive-muted: #FCE5E1; --destructive-muted-foreground: #C0392B;

  /* task-status dots (the dot system — no tinted status surfaces) */
  --status-not-started-dot: #B07C10; --status-not-started-foreground: #8A600E;
  --status-in-progress-dot: #2F6DB5; --status-in-progress-foreground: #2F6DB5;
  --status-done-dot: #3F7A52;        --status-done-foreground: #3F7A52;
}

.dark {
  color-scheme: dark;
  --background: var(--bb-neutral-950);     --foreground: var(--bb-neutral-50);
  --card: var(--bb-neutral-900);           --card-foreground: var(--bb-neutral-50);
  --popover: var(--bb-neutral-900);        --popover-foreground: var(--bb-neutral-50);
  --primary: var(--bb-gold-300);           --primary-foreground: #17130D;
  --secondary: var(--bb-neutral-850);      --secondary-foreground: var(--bb-neutral-200);
  --muted: var(--bb-neutral-850);          --muted-foreground: var(--bb-neutral-300);
  --accent: #2E2717;                       --accent-foreground: var(--bb-gold-300);
  --link: var(--bb-blue-300);
  --destructive: var(--bb-red-400);        --destructive-foreground: var(--bb-red-950);
  --success: var(--bb-green-300);          --success-foreground: var(--bb-neutral-950);
  --warning: var(--bb-orange-300);         --warning-foreground: var(--bb-black);
  --border: var(--bb-neutral-800);         --border-strong: var(--bb-neutral-700);
  --input: var(--bb-neutral-500);
  --ring: var(--bb-gold-300);              --gold: var(--bb-gold-300);

  --success-muted: #26301B;    --success-muted-foreground: #A9C98C;
  --warning-muted: #3A2A11;    --warning-muted-foreground: #EBB363;
  --destructive-muted: #3A211B; --destructive-muted-foreground: #EB9384;

  /* dark status dots brighten to hold ≥3:1 on the char canvas; inks match the dots */
  --status-not-started-dot: #E0A63C; --status-not-started-foreground: #E0A63C;
  --status-in-progress-dot: #6FA8E8; --status-in-progress-foreground: #6FA8E8;
  --status-done-dot: #7FC496;        --status-done-foreground: #7FC496;
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
  --color-border-strong: var(--border-strong);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-link: var(--link);
  --color-gold: var(--gold);

  /* the fixed black chrome (side nav) — theme-independent by design */
  --color-nav-surface: var(--bb-nav-surface);
  --color-nav-border: var(--bb-nav-border);
  --color-nav-ink: var(--bb-nav-ink);
  --color-nav-muted: var(--bb-nav-muted);
  --color-nav-active: var(--bb-nav-active);
  --color-nav-gold: var(--bb-gold-300);

  /* soft status variants (bg-success-muted / text-success-muted-foreground, …) */
  --color-success-muted: var(--success-muted);
  --color-success-muted-foreground: var(--success-muted-foreground);
  --color-warning-muted: var(--warning-muted);
  --color-warning-muted-foreground: var(--warning-muted-foreground);
  --color-destructive-muted: var(--destructive-muted);
  --color-destructive-muted-foreground: var(--destructive-muted-foreground);

  /* task-status dots (bg-status-done-dot / text-status-done-foreground, …) */
  --color-status-not-started-dot: var(--status-not-started-dot);
  --color-status-not-started-foreground: var(--status-not-started-foreground);
  --color-status-in-progress-dot: var(--status-in-progress-dot);
  --color-status-in-progress-foreground: var(--status-in-progress-foreground);
  --color-status-done-dot: var(--status-done-dot);
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

- sm — 8px (base − 4). Small controls, badges.
- md — 10px (base − 2). Buttons, chips, inputs (inputs moved up from sm in the 2026-08-13
  density pass, matching the approved replica).
- lg — 12px (the base, --radius). Sheets, dialogs — the default surface radius.
- xl — 14px (base + 2; retuned from base + 4 in the same pass). The task card's cut and large
  surfaces.
- full — 9999px. Avatars, pills, toggle knobs.
- none — 0. Available, rarely used.

### Elevation

Separation is borders-first: on-page surfaces (cards, list rows) are set apart by a border or a
surface tint, keeping the screen calm and flat. Shadows are reserved for things that genuinely
float above the page. The shadows are soft and diffuse, warm-tinted from the brand ink
(rgb(42 34 22)) rather than pure black, for the premium feel.

- 0 — none. Default page surfaces; separation via border or muted tint.
- sm — the card shadow: a tight contact line plus a soft low bloom (two layers since the
  2026-08-13 replica pass), so a card sits on the paper rather than floating over it. Also the
  sticky bottom navigation.
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

A screen can opt out of the wide cap with the `data-fills-width` attribute on its root
(2026-08-13, owner call matching the approved replica): the frame keeps its padding but sheds
the 70rem cap, so the tasks board runs its lanes to the frame's edge. Form and list screens stay
capped — a 1600px input row reads absurd. It joins the shell's other two opt-ins,
`data-fills-shell` (height-bound, for the chat pane) and `data-bleeds-shell` (cap, centring, and
padding all released, for the thread rail).

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

  /* elevation — warm-tinted, light theme; sm is the replica's two-layer card shadow */
  --bb-elevation-0: none;
  --bb-elevation-sm: 0 1px 3px 0 rgb(42 34 22 / 0.09), 0 4px 14px -6px rgb(42 34 22 / 0.12);
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

  /* radius scale derived from --radius (rounded-sm/md/lg/xl); xl is the card's 14px cut */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 2px);

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

The scale in force (The Counter, round 8, 2026-08-14 — the app was cut to the approved
artifact's own measurements, which superseded the 2026-08-13 "one notch up" call): caption
11.5px, label 13px, body 13.5px, heading-sm 15px, heading-md 19px, heading-lg 21px on the
phone and 24px from `md`, display 23px. It deliberately does not coincide with Tailwind's
numeric text-* steps; components reach for the named roles and nothing else. The 16px floor
survives as an input rule, not a body rule — form fields hold text-base 16px below `md`, the
threshold under which iOS auto-zooms a focused field, and step down to the body role above it.

**Every size in the app comes from these seven roles.** There are exactly three sanctioned
exceptions, and no others: that 16px input floor; the brand marks (the wordmarks, the login
ghost, the assistant's ( B ), avatar initials), which are artwork sized to their lockup rather
than text in the reading scale; and the `em`-relative inline code in rendered Markdown. An audit
on 2026-08-16 found roughly fifty sites that had drifted onto Tailwind's default steps
(text-sm/xs/base) or onto hand-rolled arbitrary values, and folded them all back onto the roles;
if a size is reached for that the scale does not have, the answer is to pick the nearest role,
not to write the number.

Scale is responsive at the root, not per role (owner call 2026-08-16 — the artifact's density was
drawn at laptop width and read small on a desk monitor). Because every size, control height, gap
and padding in the system is authored in rem, the root font size is the one lever that scales the
interface as a set: 16px through tablet, 17px from `xl`, 18px from `2xl`. The roles themselves do
not change, so the proportions of the approved density survive intact and the phone is untouched.
The one per-role responsive step is heading-lg, which takes its `md` jump so a page title leads
properly on a desktop.

Weight is mapped by role, not chosen per component: page titles 800, section titles at body size
700, card and list titles 600, interactive rows 500, badges/counts/overlines/table headers 700
with tabular figures, running body 400. At caption size four weights legitimately coexist because
four different roles share that size — the overline and the table header at 700, a badge at 600, a
tab-bar label at 500, an avatar initial at 800.

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

Size and line-height, each role a size paired with a line-height (the raised scale, 2026-08-13
— the named roles do not coincide with Tailwind's numeric text-* steps):

- caption — 0.8125rem (13px), line-height 1.4. Badges, counts, field labels, metadata.
- label — 0.875rem (14px), line-height 1.4. Buttons, pills, navigation.
- body — 0.9375rem (15px), line-height 1.45. Default running text.
- heading-sm — 1.0625rem (17px), line-height 1.35. Dialog and section titles.
- heading-md — 1.4375rem (23px), line-height 1.25. Detail titles.
- heading-lg — 1.75rem (28px), line-height 1.2. Page h1.
- display — 1.875rem (30px), line-height 1.15. Hero and auth headline.

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

The type meets the WCAG 2.2 AA bar set in principles.md. Body is weight 400 at 15px — Rubik's
larger x-height keeps it comfortably legible there — and weight 300 appears only as large,
non-critical display. Interactive text bottoms out at the 14px label role at weight 600, always
inside the 44px touch targets the layout section mandates; the 13px caption floor is held and
inputs stay at 16px, the mobile auto-zoom threshold.
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

  /* size / line-height — the approved artifact's own measurements (The Counter, round 8),
     not pinned to Tailwind's numeric text-* steps; inputs alone hold the 16px text-base
     floor, and the whole set scales with the root size at xl/2xl rather than per role */
  --bb-text-caption: 0.71875rem; --bb-leading-caption: 1.4;  /* 11.5px — badges, counts, overlines */
  --bb-text-label: 0.8125rem;    --bb-leading-label: 1.4;    /* 13px — buttons, pills, nav */
  --bb-text-body: 0.84375rem;    --bb-leading-body: 1.5;     /* 13.5px — running text */
  --bb-text-heading-sm: 0.9375rem; --bb-leading-heading-sm: 1.35; /* 15px — section titles */
  --bb-text-heading-md: 1.1875rem; --bb-leading-heading-md: 1.25; /* 19px — dialog titles */
  --bb-text-heading-lg: 1.3125rem; --bb-leading-heading-lg: 1.2;  /* 21px, 24px from md — page h1 */
  --bb-text-display: 1.4375rem;  --bb-leading-display: 1.15;    /* 23px — auth headline, stat number */
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
