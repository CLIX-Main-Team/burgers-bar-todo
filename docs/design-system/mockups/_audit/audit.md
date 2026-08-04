# Screen audit — current app vs. the design system

**Ticket:** [#174 — Audit current screens against the design system](https://github.com/IamIsthill/burgers-bar-todo/issues/174) (part of the [screen-mockups map #173](https://github.com/IamIsthill/burgers-bar-todo/issues/173)).

This is the grounded **"before"** the mockup tickets fix against — a per-screen catalogue of concrete failures, not a redesign. It exists so every downstream mockup (shell #175, flagship board #176, and the fan-out #177–#180) starts from a shared, honest picture of what's wrong today.

## Method

The built SPA (`vite build` + `vite preview`) was driven with Playwright, seeding a stub session and stubbing `/auth/me` + the data reads exactly as the e2e suite does, so every authenticated screen renders with representative data. Each v1 screen was captured at **mobile 375×812** and **desktop 1440×900** (DPR 2). Screenshots live alongside this file in [`screens/`](./screens/).

Captured: the four pre-auth screens (login, reset-request, reset-consume, invite-accept), the app chrome (header + tab-bar + account menu), the task board as **manager** and **employee**, the assistant placeholder, and the people screen as **admin** (the richest role). Light theme only; see "Not audited" below.

## Headline

The **mobile** experience is in good shape: the design system (cream surfaces, rounded cards, status/priority chips, name pills, Phosphor icons, the branded pre-auth split) is applied cleanly and reads as an intentional product. **The desktop experience is the problem the map named** — every in-app screen is a mobile-first capped column marooned in the centre of a 1440px viewport, with the mobile bottom tab-bar stranded underneath. The app looks like a phone screenshot pinned to a monitor. The pre-auth screens are the exception: they already have a genuine desktop layout (the branded split).

---

## Cross-cutting defects (recur on most/all in-app screens)

**X1 — Marooned narrow column on desktop.** *(shell)* Every in-app screen caps content to a mobile column (~540–620px) and centres it, leaving ~700px of empty cream on each side at 1440px. This is the core "doesn't look good on web" problem. → shell #175. See [`tasks-manager-desktop.png`](./screens/tasks-manager-desktop.png), [`people-admin-desktop.png`](./screens/people-admin-desktop.png).

**X2 — Bottom tab-bar stranded on desktop.** *(shell)* The mobile bottom tab-bar (Tasks / Assistant) persists unchanged at 1440px — a full-width white bar with two centred icons at the bottom of the screen. Desktop wants a persistent side nav, not a phone tab-bar. → shell #175.

**X3 — App header contents inset to the narrow column, and unbranded.** *(shell)* On desktop the header is full-bleed white but the "Burgers Bar" wordmark and account avatar are pinned to the capped column's edges, leaving the header's left and right thirds empty. Separately, the in-app header shows plain text **"Burgers Bar"**, not the brand lockup (BURGERSBAR + bun-bracket motif) the pre-auth screens use — a brand-consistency gap. See [`tasks-manager-desktop.png`](./screens/tasks-manager-desktop.png).

**X4 — Single-column density; content too wide for its payload.** *(board, people)* Lists render one item per row in a column sized for a phone. On desktop the cards are wide and sparse — status/priority chips strand at the far right with a large empty gutter. Desktop wants multi-column / denser layout (board status-columns, a people table). See [`tasks-manager-desktop.png`](./screens/tasks-manager-desktop.png).

**X5 — Raw, unstyled native `<select>` controls.** *(board employee, people)* Status change (employee board), Role, and Filter-by-location all use bare browser `<select>` elements — default OS chrome, default dropdown arrow — visibly not a design-system component. See [`tasks-employee-desktop.png`](./screens/tasks-employee-desktop.png), [`people-admin-mobile.png`](./screens/people-admin-mobile.png).

---

## Per-screen findings

### Pre-auth — Login  ([mobile](./screens/login-mobile.png) · [desktop](./screens/login-desktop.png))

The branded AuthLayout split (#123) is applied and looks intentional. Defects are minor:

- **Desktop:** form inputs span the full half-panel width (~460px) — very wide for an email/password form, so the fields feel unanchored; the form block floats with a large void of white below it (weak vertical composition).
- **Mobile:** an awkward, large empty vertical gap sits between the language toggle and the "Sign in" block — content is not vertically balanced; the toggle floats alone.

### Pre-auth — Reset request  ([desktop](./screens/reset-request-desktop.png) · [mobile](./screens/reset-request-mobile.png))

Consistent with login; same wide-input / floating-form notes. Otherwise clean.

### Pre-auth — Reset consume (set new password)  ([mobile](./screens/reset-consume-mobile.png) · [desktop](./screens/reset-consume-desktop.png))

- **Inconsistent subtitle:** the sub-heading reads a bare **"Burgers Bar"** where the parallel invite-accept screen has a full sentence ("Welcome. Set a password to finish setting up your account."). Reads like a placeholder/leftover, not intentional copy.
- Same wide-input / floating-form notes as the other auth screens.

### Pre-auth — Invite accept  ([desktop](./screens/accept-desktop.png) · [mobile](./screens/accept-mobile.png))

Clean and consistent with the rest of the AuthLayout family. Same minor wide-input note.

### App chrome — header, tab-bar, account menu  ([account menu desktop](./screens/account-menu-desktop.png) · [mobile](./screens/account-menu-mobile.png))

- The **account menu** is the most DS-mature chrome: a proper dropdown with segmented Light/Dark and English/עברית toggles, "Manage users", and log-out actions. Keep as the quality bar.
- Menu header reads "Signed in as **Manager**" — shows the role, not the person's name/email (minor).
- Header + tab-bar carry defects **X1–X3** above (inset, unbranded, stranded on desktop).

### Task board — Manager  ([mobile](./screens/tasks-manager-mobile.png) · [desktop](./screens/tasks-manager-desktop.png) · [full page](./screens/tasks-manager-full-desktop.png))

- **Mobile: good.** Clean card list, DS fully applied, "Sort by priority" + primary "New task", status/priority chips, name pills. This is the reference for "what good looks like" on phone.
- **Desktop:** carries **X1, X2, X3, X4** — marooned ~620px column, stranded tab-bar, inset header, sparse wide cards. A manager's location board (6 tasks incl. backlog) becomes a long single-column scroll where a status-column board would fit the width.
- Per-card **Edit / Delete** actions are always visible on every card — heavy repeated chrome, especially at desktop density.

### Task board — Employee  ([desktop](./screens/tasks-employee-desktop.png) · [mobile](./screens/tasks-employee-mobile.png))

- Role scoping is correct: own tasks only, no backlog, no "New task" (only "Sort by priority").
- Per-card status control is a **raw native `<select>`** (defect **X5**) — the most jarring DS break on this screen.
- Same desktop shell defects (**X1–X4**).

### Assistant  ([desktop](./screens/assistant-desktop.png) · [mobile](./screens/assistant-mobile.png))

- **Placeholder only** — "The assistant arrives in a later release." There is no real screen to audit; its mockup (#178) is effectively net-new design.
- On desktop the placeholder heading strands at the top of the inset column over a vast empty cream field — a stark illustration of **X1**.

### People — Admin  ([mobile](./screens/people-admin-mobile.png) · [desktop](./screens/people-admin-desktop.png))

The least DS-mature in-app screen; richest defect set.

- **Raw Location UUIDs exposed to users** — every person card prints `Location: 44444444-4444-4444-4444-444444444444`, and the invite form requires a **"Location ID"** typed as a raw UUID ("The ID of the Location this person belongs to"). This is a real usability failure; it should be a named-location label / picker. (Ties to the location-management umbrella #163.)
- **Native `<select>`** for Role and Filter-by-location (defect **X5**).
- **Desktop:** marooned narrow column (**X1**); the invite form and the person list stack vertically when a two-column layout or a proper **table** would use the width and cut the scrolling. The always-open invite-form card occupies prime real estate above the list.
- Invite / Active / Deactivated sectioning, status chips, and the destructive-action styling (Deactivate / Revoke in red) are good and DS-consistent — keep.

---

## Not audited (out of this pass)

- **Dark theme** — the app supports it (account-menu toggle); only light was captured. Map fog: how exhaustively mockups render themes.
- **Hebrew / RTL** — captured LTR English only. Map fog: whether mockups render RTL directly.
- **Transient states** — loading / error / empty / offline were not driven. Map fog: how exhaustively each mockup renders states. (One "empty" was seen incidentally: People → Deactivated shows a clean "No deactivated people." empty line — good.)
