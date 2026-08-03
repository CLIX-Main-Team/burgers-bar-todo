# features — map

Per-feature planning artifacts (ui-flow, plan, Test Cases) for features in or approaching the
build. A feature's PRD lives in GitHub as its issue; this folder holds the documents derived from
it. Open a feature's own readme before its files.

Folders:

- assistant/ — the Assistant: the in-app grounded chatbot, its Google Drive knowledge corpus, and
  the usage-driven sync that mirrors that corpus into a local cache. See assistant/readme.md.
- auth/ — the invite-only email/password auth surface (seeded admin, invite lifecycle, sign-in,
  logout and logout-all, password reset, deactivate/reactivate), delivered as one unit. See
  auth/readme.md.
- design-system-wiring/ — wiring the Burgers Bar design system into apps/web: the token
  foundation, the dark-mode toggle, the retheme of the shadcn/ui primitives, and the surface sweep
  across the built auth, people, and shell screens. See design-system-wiring/readme.md.
