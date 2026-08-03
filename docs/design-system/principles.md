# Design principles

The philosophy the Burgers Bar staff-app design system answers to. This document sets the
principles, the cross-cutting rules, and the accessibility bar that every token and component
decision serves; it does not carry token values. The concrete colour roles and values live in
tokens.md (decided by the colour ticket), the type scale in the typography ticket, and spacing,
radius, elevation, breakpoints, and touch targets in the layout-token ticket. When a rule here
names a number, it is the bar those tickets must meet, not the token itself.

The system is a retheme, not a redesign: a token and guideline layer over the shadcn/ui and
Tailwind components inherited from Clix-CRM. Component structure is preserved and restyled, not
rebuilt. That decision, and the three-tier token and class-based light/dark architecture beneath
it, are recorded in the design-system map and its research; this document assumes them.

## Operating context

We design for typical mobile conditions: a staff member using their own phone in ordinary indoor
light, often with both hands free, in a calm moment rather than mid-service on the line. This is a
deliberate scoping choice. The task board, the assistant, and onboarding are not treated as a
hardened floor or kitchen instrument built for glare, grease, gloves, or one-second glances; that
worst-case framing was considered and set aside. The consequence runs through the rest of this
document: the accessibility bar is a standard conformance target rather than an elevated
floor-hardened one, and density and contrast are sized for comfort, not for a hostile environment.

Most users are occasional, non-power users — employees who open the app to see their tasks and ask
the assistant a question, not operators living in a dense board all day. The design favours the
occasional user throughout.

## The principles

### 1. Mobile-first, one thumb

The app is designed for a phone held in one hand. Primary actions and navigation live in the
bottom thumb zone — a bottom navigation bar, bottom sheets, and the primary action in the lower
reach — while the top of the screen is reserved for titles and context that are read, not tapped.
This is a soft governing rule the component tickets honour by default, not a hard mandate on every
screen: where a surface has a good reason to place an action elsewhere, it may, but the default and
the burden of proof sit with thumb reach. Touch targets are forgiving (see the accessibility bar).

### 2. Hebrew-first, direction-native

Hebrew and right-to-left are the canonical design. Screens are designed, specified, and reviewed
in Hebrew/RTL first; English and left-to-right are the verified mirror, produced automatically
rather than laid out by hand. The direction a given user sees follows their preferred language,
stamped on the document the way the locale is, and the layout mirrors through logical properties
alone — no direction-specific machinery, no separate LTR stylesheet. RTL is the design's home
direction, not an afterthought bolted onto an LTR base.

The RTL/LTR conventions that follow from this are set out in their own section below.

### 3. Calm and comfortable

The system defaults to comfortable density: generous spacing, roomy tap rows, and one clear
primary action per screen. Fewer things per screen, each easy to read and to hit. This suits a
mobile-first app whose users are mostly occasional. Comfortable is the only density built for v1.

A compact density is a reserved future option, not built now. Because spacing is fully tokenised,
a compact mode can later be introduced by swapping the spacing scale without re-speccing
components — the door is deliberately left open, and this is not a one-way door. Building and
testing a second density and a toggle in v1 was considered and set aside as scope the first
release does not need.

### 4. Warm, plain, respectful

The brand voice is warm, kosher-proud, and premium-casual, and the UI copy carries it as warmth
through courtesy and encouragement, not through personality-heavy quips. Copy is human but
efficient: clear verbs, short sentences, no jargon, no jokiness. A control says exactly what it
does, and its confirmation echoes it. Encouragement is allowed and welcome ("Done. Nice work.");
mascots, food puns, and cleverness are not — they wear thin for staff who use the app many times a
shift and are hard to keep consistent across two languages.

Copy is written natively in each language, not translated literally from the other. The same
personality reads in Hebrew and in English; the words are not a word-for-word mirror.

Errors explain what went wrong and what to do next, without apology or vagueness.

### 5. Accessible by default

Accessibility is a target the palette and the layout are built to from the start, not a retrofit.
The bar is WCAG 2.2 AA, specified in its own section below. It is a standard, credible conformance
target, right-sized for a small-client staff app, and it constrains the token tickets: a colour
pairing or a target size that cannot meet it is not shipped.

### 6. Retheme, don't redesign

The design system is a token and guideline layer over the inherited shadcn/ui and Tailwind
component structure. Components are restyled through tokens, not rebuilt; their structure,
behaviour, and accessibility affordances are preserved. New visual identity is expressed in the
token layer and the guidelines here, so the component inventory maps each surface to the shadcn
primitive it inherits rather than inventing bespoke components.

One surface holds a sanctioned exception to this rule: the shared pre-auth frame (AuthLayout — the
login, accept-invite, and password-reset screens) is redesigned, not merely rethemed, into a
branded desktop split. The exception is bounded to that frame; the forms inside it and every
authenticated surface remain pure retheme. The reasoning and the exact boundary are recorded in
ADR-0018, and the redesigned frame is specified in components.md.

## RTL and LTR conventions

Direction follows the user's preferred language: Hebrew renders right-to-left, English
left-to-right. The mechanism is logical properties throughout — inline-start and inline-end,
margin-inline, padding-inline — so a single layout serves both directions and LTR is the automatic
mirror of the RTL canonical.

User-generated content keeps its own direction, independent of the surrounding chrome. The UI
chrome follows the user's language, but each piece of content a user authored — task titles,
display names, chat messages, knowledge-base text — is laid out in its own direction and isolated
so it cannot corrupt the surrounding layout. A Hebrew user reading an English-authored task title
sees it left-aligned and left-to-right inside otherwise right-to-left chrome, and the reverse holds
for an English user reading Hebrew content. Content follows the content, not the chrome.

Directional icons mirror; universal icons do not. Icons that carry a direction — back arrows,
chevrons, progress and next/previous affordances — flip with the layout. Icons whose meaning has no
direction — search, settings, a checkmark — stay as they are.

Numerals are Western Arabic (0–9) in both languages, which is the normal convention for Hebrew
staff-facing software.

## The accessibility bar

The whole system commits to WCAG 2.2 AA. This is the conformance target the colour and layout
token tickets must satisfy, stated here as concrete numbers:

- Text contrast is at least 4.5:1; large text and the meaningful parts of UI components are at
  least 3:1. A brand pairing that cannot meet this — for example a warm gold behind white — is
  reworked (dark ink on gold, not white on gold) rather than shipped below the ratio.
- Touch targets are at least 44 by 44 pixels. This sits above the 24-pixel WCAG floor and matches
  mobile-platform norms and the comfortable density; it is the practical minimum, not the aspiration.
- Keyboard and assistive-technology focus is always visibly indicated. No surface removes the focus
  indicator without replacing it with an equally clear one.
- Motion respects prefers-reduced-motion: where the setting is on, non-essential animation is
  reduced or removed.

## Scope of this document

This document decides the principles, the RTL/LTR conventions, the voice, and the accessibility bar
only. The colour system with its light and dark values, the Hebrew/Latin typography pairing and
type scale, the layout tokens, and the component inventory are decided in their own tickets and
recorded in tokens.md and components.md alongside this file. Iconography, imagery, and motion
guidance beyond the reduced-motion rule above are out of scope here and surface once the visual
foundations are set.
