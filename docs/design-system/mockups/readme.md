# mockups — applying the design system to every v1 screen

Per-screen **responsive mockup specs** that apply the already-complete design system (the
principles, tokens, components, and iconography one level up) to every v1 screen, and invent the
desktop shell the DS never specified. This is a planning effort, tracked as the
[screen-mockup-specs map #173](https://github.com/IamIsthill/burgers-bar-todo/issues/173): it
decides what each screen should look like at a mobile and a desktop breakpoint; the actual rebuild
is downstream and not part of it.

When the mockup tickets land, each screen gets its own `<screen>/` folder here holding a
self-contained `mockup.html` (real DS tokens, fonts, and icons, rendered at both breakpoints) plus a
`spec.md` (the prose a build feature reads). Read this index first, then the screen folder the task
needs.

Contents:

- `_audit/` — the grounded **"before."** `audit.md` catalogues the concrete failures of every
  current screen (auth ×4, app chrome, task board manager + employee, assistant, people) at mobile
  375px and desktop 1440px, with the screenshots it references under `_audit/screens/`. This is the
  honest picture every mockup fixes against; it is a baseline, not a design. Produced by
  [#174 — Audit current screens against the design system](https://github.com/IamIsthill/burgers-bar-todo/issues/174).
- `shell/` — the **canvas** every screen composes on: how the app chrome transforms from phone to
  desktop (bottom tab-bar → role-aware side nav, wide capped content, shell at `md` / columns at
  `lg`). The shared `mockup.html` `<head>` is the harness every later screen copies. Produced by
  [#175 — Responsive app shell & navigation mockup](https://github.com/IamIsthill/burgers-bar-todo/issues/175).
- `task-board/` — the **flagship reference screen**: the manager task board as a desktop status
  kanban inside the shell, fixing "what good looks like" (density, card treatment, the create/edit
  sheet, backlog, and the empty/loading/error states) the fan-out screens then match. Produced by
  [#176 — Task board flagship mockup (manager view)](https://github.com/IamIsthill/burgers-bar-todo/issues/176).
- `assistant/` — the **grounded ops-assistant chat**: the asymmetric ChatBubble thread (secondary
  user bubble / no-bubble assistant voice), the Composer, and the ThreadList promoted to a desktop
  **rail in-frame** (a mobile **Sheet** below `lg`), with a book-measure conversation and the
  first-run / pending / error / grounded-refusal states. Produced by
  [#178 — Assistant screen mockup](https://github.com/IamIsthill/burgers-bar-todo/issues/178).
- `people/` — the **manager / admin people surface**: the invite roster as a **status-grouped table**
  on desktop and a **stacked card list** on mobile (named locations, never UUIDs; a DS Select filter;
  row actions in an overflow menu), plus the **invite form** as a bottom Sheet / inline-end drawer,
  the manager (single-location) view, and the empty / loading / error states. Produced by
  [#179 — People management screen mockup](https://github.com/IamIsthill/burgers-bar-todo/issues/179).
