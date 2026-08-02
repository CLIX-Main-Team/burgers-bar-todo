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

Not yet written (each graduates from its ticket as it closes):

- tokens.md — semantic colour roles with light and dark values, the Hebrew/Latin typography pairing
  and type scale, and spacing, radius, elevation, breakpoints, and touch targets.
- components.md — the component inventory with states for v1's surfaces plus the core primitive kit,
  each mapped to the shadcn/ui primitive it inherits.
