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
  roles with light and dark values, the three-tier architecture, and drop-in CSS) is decided; the
  typography pairing and type scale, and the spacing, radius, elevation, breakpoint, and
  touch-target tokens, are appended as their tickets close.

Not yet written (each graduates from its ticket as it closes):

- components.md — the component inventory with states for v1's surfaces plus the core primitive kit,
  each mapped to the shadcn/ui primitive it inherits.
