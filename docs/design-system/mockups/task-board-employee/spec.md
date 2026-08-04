# Task board — employee (read-only) mockup · spec

The **employee variant** of the flagship board (map #173, ticket #177, a child of the flagship
#176). It is the same board seen through the employee's permissions: **own assigned tasks only**,
and exactly **one write action per card**. This spec inherits the shell (#175) and matches the
flagship's (#176) density, hierarchy, and composition language wholesale; it states only what
**differs** from the manager view, so the two files read as a pair.

Read `docs/design-system/principles.md`, `tokens.md`, `components.md`, and `iconography.md` first,
the shell spec `../shell/spec.md` second, and the flagship spec `../task-board/spec.md` third — this
file names their roles and never restates their values, and it draws its chrome (side nav,
content-header, content frame) and its kanban composition entirely from those. The companion
`mockup.html` is the visual truth: it starts from the flagship's harness (the same token CSS,
embedded Assistant variable font, Phosphor `<symbol>` sprite, device-frame + toggle scaffold) and
renders the board at **mobile / tablet / desktop**, in **RTL (Hebrew, canonical) and LTR (English)**,
in **light and dark**, plus a **StatusControl-open** view on both desktop and mobile, and the
**empty / loading / error** states.

## The core truth

The shipped employee board (`apps/web/src/features/tasks/status-task-card.tsx`, `tasks-screen.tsx`)
shows a staff member **their own assigned tasks and nothing else**: no backlog (managers/admins
only, PRD), no New-task, no create / edit / delete, no drag-to-reorder. Each row is a read-only
TaskCard carrying **one** write affordance — a status change, any → any of `not_started` /
`in_progress` / `done`. Today that control ships as a raw native `<select>`, which the #174 audit
flagged as **X5**, "the most jarring DS break on this screen."

This mockup's whole job: keep that single write, rendered as the design system's **StatusControl**
(the X5 fix — `components.md` §StatusControl), and strip everything the employee cannot do.

## Deliberate divergences from the flagship manager card

Each divergence is a subtraction or substitution the employee's permissions require, not a
restyle. They are listed here so the pairing with the flagship is legible and none is smuggled in.

1. **The StatusControl pill is visible on every card.** The manager card carries *no* standalone
   status chip — its lane names the status, and status is changed by drag between lanes with the
   overflow **Move to…** menu as the accessible fallback. The employee **cannot drag**, so the pill
   is their sole move affordance and must be present and legible on each card. This is the one place
   the employee card *adds* rather than removes, and it is the deliberate lane+pill pairing described
   below.
2. **The assignee Avatar stack is dropped.** Every task on this board is the viewer's own, so a
   self-avatar is pure noise; the meta row spends that inline-end space on the due date alone.
3. **The drag grip and the overflow menu are gone.** No reorder (`dots-six-vertical`) and no
   Edit / Delete / Move-to (`dots-three`) — the employee neither reorders nor edits, and the one
   action the overflow used to hide (status change) is now the always-visible pill.
4. **The content-header loses New-task, Search, and the FAB.** It keeps only the **Sort by
   priority** toggle — the employee's one read-lens, and shipped behaviour. There is no create
   affordance anywhere on the surface, at any breakpoint.
5. **The empty state has no create CTA.** Its copy is "No tasks assigned to you" / "All clear —
   nothing's assigned to you right now." — a warm line only, no false affordance (principle 4).

Everything else — the shell, the kanban composition, the card's title/priority anatomy, the done
dimming, the display states' loading and error panels — is inherited from the flagship unchanged.

## Layout regions

The board renders into the shell's **content-inner** (capped `--bb-content-max` on mobile,
`--bb-content-wide` on desktop, centred). It draws its own **content-header** and **board body**;
it never draws chrome. The **side nav** shows only **Tasks** (active) and **Assistant** — the
employee cannot see People or Locations (PRD permissions), so those two destinations and their
`nav-gate` badges are absent in every frame; the bottom nav already carries only Tasks and
Assistant. The account block reads **Yossi M. / Employee**.

### Content-header

The shell's content-header pattern, trimmed: the screen title (`heading-lg`) at the inline-start; at
the inline-end, a single control — the **Sort by priority** toggle (secondary/`outline` Button,
`sm`, `aria-pressed`). Sort-by-priority is the board's own read-lens and the only header action the
employee has; it rides in this cluster at every breakpoint. No Search field, no New-task Button, no
Create FAB.

### Board body per breakpoint — same kanban as the flagship

The composition is **identical to the flagship** (locked in #176). The lanes group and scan; the
per-card StatusControl moves (since the employee cannot drag). This lane+pill pairing is the
intended, deliberate employee divergence — the lane still tells the reader *where* a task sits, and
the pill is *how* the employee moves it.

| Width | Composition |
|---|---|
| `< md` (mobile) | The three status groups **stacked** as full-width sections (col-head + cards), single column, cap `--bb-content-max`. |
| `md` (768–1023) | Same stacked status sections, one **wide** column, cap `--bb-content-wide`. |
| `≥ lg` (1024) | The **3-column status kanban**: CSS grid `repeat(3,1fr)`, `gap` `space-lg`, `align-items:start`; each column a `muted`-surface tray (`radius-lg`). |

Column order (`Not started`, `In progress`, `Done`) is preserved in both directions; RTL places the
first column at the inline-start (the right). The `col-count` on each lane head is a tabular count of
the cards actually present. The sample board is realistic — **five tasks, all Yossi's**: *Not
started* (2) Deep-clean the grill, Restock burger buns (High); *In progress* (1) Sanitize prep
stations; *Done* (2) Count register at shift end, Fix walk-in fridge seal.

## TaskCard (employee)

Per `components.md` §TaskCard, tuned for this view. Title-led and title-only; the card is read-only
apart from its StatusControl.

- **Card-top** — the **Title** (`heading-sm` weight 600, wrapping to at most two lines, `dir="auto"`
  for bidi-isolated authored titles) and, **only when high priority**, the trailing **Badge** (the
  `warning`-soft chip with the `warning` glyph). Normal priority shows nothing; low a neutral `muted`
  chip. Priority is the orange family, held apart from the gold-and-neutral status family. No grip,
  no overflow — the card-top carries the title and the optional High badge and nothing else.
- **Meta row** — the **StatusControl pill** at the inline-start; then the **due date** (`caption`,
  `muted-foreground`, `calendar-blank` glyph) pushed to the inline-end, flipping to the
  `destructive`-soft foreground at weight 600 with the `clock` glyph when overdue.
- **Done card** — the whole card dims to ~55% opacity (`is-done`) and shows the **completed time**
  in the due slot with the `check-circle` glyph, no strikethrough (principle 4). Its pill reads
  **Done**.

## StatusControl — the one new component

The employee's single write, and the X5 fix. Per `components.md` §StatusControl, *the status Badge
on the card is itself the control* — a button that opens a DropdownMenu of the three statuses, the
current one checked. On this surface the badge-as-control is promoted to an always-visible **pill**,
because it is the only move affordance the employee has.

### Pill anatomy

A small soft **badge-button** (`.status-pill`): `[status glyph] [status label] [caret-down]`, at
`radius-full` to echo the Badge, `label`/600 type, with a min-block-size that reads as a control. It
carries a **1px `input`-token border** — the design system's form-control border — plus hover
(subtle brightness), a pressed inset shadow, and the `ring` focus-visible outline, so it reads as
**interactive**, not a static chip. The `caret-down` disclosure glyph names it as a menu trigger.
`aria-haspopup="menu"` and `aria-expanded` are set. Its hit area pads to `--bb-touch-min`.

### The three variants — status stays gold-and-neutral

Mapped to the status family from tokens.md / `components.md` §Badge, held apart from the orange
priority family so the two never read alike:

| Variant | Surface / ink | Glyph |
|---|---|---|
| `notStarted` | neutral `muted` + `muted-foreground` | `circle` |
| `inProgress` | `accent` (gold-soft) + `accent-foreground` | `circle-half` |
| `done` | `success-muted` (olive-soft) + `success-muted-foreground` | `check-circle` |

### The open menu (DropdownMenu)

Shown open on one card each on desktop and mobile (the In-progress card, whose single-card lane
leaves room for the popover). A `popover`-surface `.status-menu` (`border`, `radius-md`,
`elevation-md`) anchored under the pill, listing the three statuses top-to-bottom, each a row at
`--bb-touch-min` with its status glyph and label; the **current** row carries the `accent` surface
and the `check` glyph (`role="menu"`, rows `role="menuitemradio"` with `aria-checked`). One tap to
open, reversible, accessible — the compact form `components.md` calls for on a narrow card, where a
three-segment inline control would not fit at 44px targets in two languages.

## Display states

The board's own display states (`components.md` §TaskBoard), in the states frame:

- **Empty (employee)** — a `tray` glyph, the warm line "No tasks assigned to you" / "All clear —
  nothing's assigned to you right now.", and **no** call to action (the employee cannot create;
  principle 4 = a warm line, not a false affordance). This is the one state that differs from the
  flagship.
- **Loading** — **Skeleton** cards shaped like real TaskCards, a `muted` surface with a shimmer
  removed under `prefers-reduced-motion`, `aria-busy` on the region. Same as the flagship.
- **Error** — a `warning` glyph, "Couldn't load the board" / "Check your connection and try again.",
  and an `outline` **Try again**. Same as the flagship.

## RTL / LTR

Every region uses **logical properties**, so RTL-canonical is the source and LTR the automatic
mirror: the side nav sits at the inline-start, the kanban columns keep their order, and the pill
sits at the meta row's inline-start with the due date at the inline-end in both directions. No
directional icon is new to this surface (status, priority, due, caret are all universal; only the
shell's `sign-out` is directional). Authored task titles are bidi-isolated with `dir="auto"`.

## What this fixes from the #174 audit

- **X5** (raw native `<select>`) — *the* fix this variant owns: the per-card status `<select>`
  becomes the DS **StatusControl** pill + DropdownMenu.
- **X1 / X2 / X3** (marooned column, stranded tab-bar, inset unbranded header) — inherited from the
  shell (#175); the board composes inside it.
- **X4** (single-column desktop density) — inherited from the flagship kanban: the width is spent
  across three lanes even though the employee's own list is short.

## DS component & token mapping

| Region | Composes (`components.md`) | Key tokens / icons |
|---|---|---|
| Content-header | Button (`outline` Sort) | `heading-lg`, `--bb-content-wide` |
| Status lane | section + col-head (flagship composition) | `muted` tray, `radius-lg`, `foreground`/`muted-foreground`; `circle`/`circle-half`/`check-circle` (status), tabular count |
| TaskCard | TaskCard + Badge | `card`, `border`, `radius-lg`, `elevation-sm`, `heading-sm`; `warning` (high), `calendar-blank`/`clock` (due/overdue) |
| **StatusControl pill** | Badge-as-button (DropdownMenu trigger) | `muted`/`accent`/`success-muted` (the three status variants), `input` border, `radius-full`, `ring`; `circle`/`circle-half`/`check-circle`, `caret-down` |
| **StatusControl menu** | DropdownMenu | `popover`/`popover-foreground`, `border`, `radius-md`, `elevation-md`, `accent` (current row); `check` (current), status glyphs |
| Priority chip | Badge (soft) | `warning-muted` (high), `muted` (low) |
| States | Skeleton, Button, Alert | `muted` (skeleton), `warning`-soft; `tray` (empty), `warning` (error) |

## Icon roles used (registry, `iconography.md`)

`tasks` (list-checks), status `circle` / `circle-half` / `check-circle`, `caret-down` (StatusControl
disclosure), `check` (current status in the menu), `priority-high` (warning), `due` (calendar-blank),
`overdue` (clock), `tray` (empty state), `warning` (error state), plus the shell's nav/account roles.
`fill` weight stays reserved for the active nav destination (shell) and the current StatusControl
selection; the board's resting glyphs are all `regular`. The manager card's `dots-six-vertical`
(drag), `dots-three` (overflow), `pencil-simple`, `trash`, `plus`, `search`, and `tray`-as-backlog
roles are **not** used on this surface.

## Breakpoint summary

| Width | Header | Board |
|---|---|---|
| `< 768` (mobile) | title + Sort | stacked status sections, cap 30rem; per-card StatusControl |
| `768–1023` (md) | title + Sort | one wide column of status sections, cap 70rem |
| `≥ 1024` (lg) | title + Sort | 3-column status kanban, muted lanes; StatusControl shown open on one card |
