# design-system — the staff-app design system

The design-system specification for the Burgers Bar staff app: the principles, tokens, and
component inventory that a later build feature implements in apps/web. This is a planning
specification — it decides and documents the system; it does not wire it into the app. The
architecture beneath it (a token and guideline layer over the inherited shadcn/ui and Tailwind
components, three-tier tokens, class-based light/dark) is set in the design-system map and its
research; the documents here rest on it.

Read principles.md first: it sets the philosophy the token and component decisions answer to.

Documents:

- principles.md — design principles, brand voice, the RTL/LTR conventions, and the WCAG 2.2 AA
  accessibility bar. The philosophy every other decision serves. Decided.
- tokens.md — the token layer, assembled across the token tickets. The colour system (semantic
  roles with light and dark values, the three-tier architecture, and drop-in CSS), the layout
  tokens (spacing, radius, elevation, breakpoints, and touch targets), and the typography system
  (the single Assistant family, the weight ladder, and the mobile-first type scale) are all
  decided.
- components.md — the component inventory: the shared state vocabulary, the fifteen-primitive
  shadcn/ui kit (with variants, states, and token mapping), and the surface compositions for v1's
  chrome, task board, and assistant, plus the retheme deltas for the built auth and people
  screens. Decided.
- iconography.md — the UI icon system: the library (Phosphor), the `<Icon>` wrapper and semantic
  role registry that address it, the RTL / colour / weight / size / accessibility conventions, and
  the complete 39-role glyph mapping. Governed by ADR-0020. Decided.

The design system is complete: principles, tokens, components, and iconography — an approved
specification ready to hand to a build feature.

Applying it to the actual screens is a separate, in-flight effort:

- mockups/ — per-screen responsive mockup specs that apply this system to every v1 screen and
  invent the desktop shell it never specified (map #173). Currently holds `_audit/`, the grounded
  "before" that catalogues what each current screen gets wrong. See mockups/readme.md.
