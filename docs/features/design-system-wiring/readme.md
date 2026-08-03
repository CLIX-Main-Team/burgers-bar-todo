# design-system-wiring — feature planning

The rule-4 planning artifacts for wiring the Burgers Bar design system into apps/web: the token
foundation, the dark-mode toggle, the retheme of the six shadcn/ui primitives, and the surface
sweep across the built auth, people, and shell screens. Delivered as one unit (a retheme, not a
redesign — principle 6), with the theme toggle as its single behavioural addition.

The spec (PRD input) for this feature is the design system itself, under ../../design-system/ —
read principles.md first, then tokens.md (its reference CSS is the implementable form), then
components.md (the retheme deltas). The build ticket is GitHub issue #101, "Implement: Wire the
design-system foundation + retheme built surfaces", which graduates from the design-system map
(#65) and is sequenced by build-sequencing map #53.

Rooms in this folder:

- ui-flow.md — the user-facing surface. The retheme changes no flow, so most of this is recorded
  as such; the one new control, the light/dark theme toggle in the account menu, is specified
  here. Text-first per rule 11.
- plan.md — the implementation plan: the foundation-first build order, the module seams, the
  no-behaviour-change gate, and the risks.
- test-cases.md — the cases derived from issue #101's acceptance: behaviour-unchanged evidence,
  the theme-toggle behaviour, and the token-conformance checks.

Why foundation-first: the token layer is a shared prerequisite. The shell (#80) already merged on
slate and the Assistant slice (#83) inherits it; landing the foundation as the next build, ahead
of #83, stops every later surface being built on slate and rethemed after the fact — the debt that
left the login flow unbranded.

This feature rests on the theming architecture decided in #68 and on the Engineering Design
(../../engineering-design.md). It records no new ADR: #68 already made the decision this feature
executes.
