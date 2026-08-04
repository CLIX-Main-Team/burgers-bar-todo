# Task board — flagship mockup (manager view) · spec

The **reference screen** of the mockup set (map #173, ticket #176): what "good" looks like on the
densest, most-used surface, made concrete inside the decided shell. It fixes the density, hierarchy,
and composition language every fan-out screen then matches, so this file is written to read as the
pattern the others copy.

Read `docs/design-system/principles.md`, `tokens.md`, `components.md`, and `iconography.md` first,
and the shell spec `../shell/spec.md` second — this spec names their roles and never restates their
values, and it draws its chrome (side nav, content-header, content frame) entirely from the shell.
The companion `mockup.html` is the visual truth: it starts from a copy of the shell's mockup harness
(the same token CSS, embedded Assistant variable font, and Phosphor `<symbol>` sprite) and renders
the board at **mobile / tablet / desktop**, in **RTL (Hebrew, canonical) and LTR (English)**, in
**light and dark**, plus the **create/edit sheet** (mobile + desktop) and the **empty / loading /
error** states.

## The composition decision (locked in #176)

The desktop board is a **3-column status kanban** — `Not started` / `In progress` / `Done`. This is
the one open decision the shell (#175) deferred to the flagship: the shell's breakpoint table
gestured at status columns but marked its sample cards placeholder. #176 locks the kanban.

Why: it is the answer that most decisively spends the desktop width the #174 audit found wasted
(**X1**, **X4** — the "marooned narrow column"), and it reads instantly as a board a manager scans
across a shift.

**Behavioural implication the build must own.** The shipped board (task-board map #129) is a *single
manually-ordered list*: drag **reorders** a shared `position`, a "Sort by priority" toggle is a
per-viewer lens that disables drag, and status changes through a per-card control. A kanban
reinterprets drag as **move-between-columns = set status**. That is a genuine board-feature
behaviour change, not a restyle — this mockup fixes the *visual and compositional* target and flags
the interaction change for the downstream build to design and own (drag-to-column sets status;
within-column drag keeps manual `position`; the priority lens re-orders within each column and
disables drag, unchanged). It is called out here so it is not smuggled in as "just a mockup."

**Backlog is orthogonal to status, so it stays a per-card chip, not a column.** A backlog task
(no assignee — managers/admins only, PRD) still has a status, so it lives in its status column
(most often `Not started`) carrying a `Backlog` chip in place of the assignee stack. There is no
separate backlog rail to strand.

## Layout regions

The board renders into the shell's **content-inner** (capped `--bb-content-max` on mobile,
`--bb-content-wide` on desktop, centred). It draws its own **content-header** and **board body**;
it never draws chrome.

### Content-header

The shell's content-header pattern: the screen title (`heading-lg`) at the inline-start; a
right-grouped action cluster at the inline-end holding, in order — a **Search** field (`input`
border, `--bb-control-height`, `radius-md`; desktop only, per shell), a **Sort by priority** toggle
(secondary/`outline` Button, `sm`, `aria-pressed`), and the **New task** `primary` Button (with the
`create` plus glyph). On mobile the primary create action is the shell's **Create FAB**; New task in
the header is the desktop replacement (shell decision 3). Sort by priority is the board's own lens
control and rides in this cluster at every breakpoint.

### Board body per breakpoint

| Width | Composition |
|---|---|
| `< md` (mobile) | The three status groups **stacked** as full-width sections (col-head + cards), single column, cap `--bb-content-max`. The audit's "good" mobile list, now grouped by status. |
| `md` (768–1023) | Same stacked status sections, one **wide** column, cap `--bb-content-wide`. No side-by-side columns yet (shell decision 4 — the ~500px content area at `md` stays single-column). |
| `≥ lg` (1024) | The **3-column kanban**: a CSS grid `repeat(3,1fr)`, `gap` `space-lg`, `align-items:start`. Each column is a `muted`-surface tray (`radius-lg`) so the columns read as lanes. |

The column order (`Not started`, `In progress`, `Done`) is preserved in both directions; RTL places
the first column at the inline-start (the right).

### Column (status lane)

A `<section>` per status: a **col-head** (the status glyph in `regular` weight — `circle` /
`circle-half` / `check-circle` from the icon registry — the status label in `label`/600, and a
tabular **count** pushed to the inline-end) above a **col-body** stack of TaskCards at `space-sm`
gaps. The tray `muted` surface appears only at `lg`; below it the sections are open (header + cards).

## TaskCard

The signature composition, per `components.md` §TaskCard, tuned for the kanban lane. Title-led and
title-only (no description preview — the note lives in the edit sheet). Anatomy, top row then meta:

- **Drag grip** (`dots-six-vertical`, `muted-foreground`, low opacity) at the inline-start of the
  card-top — the reorder / move affordance (managers/admins; hidden interaction for employees, out
  of scope for this view).
- **Title** — `heading-sm` weight 600, wrapping to at most two lines, `dir="auto"` so an authored
  Hebrew title reads RTL inside an English UI and vice-versa.
- **High-priority Badge** trailing the title — the `warning`-soft chip with the `priority-high`
  (`warning`) glyph, shown **only** when priority is high; `normal` shows nothing (the implicit
  default, to cut board noise), `low` a neutral `muted` chip. Priority is the orange family, held
  apart from the gold-and-neutral status family so the two never read alike.
- **Overflow menu** (`dots-three` ghost icon Button, hit area padded to `--bb-touch-min`) at the
  inline-end — a DropdownMenu carrying **Edit**, **Delete** (→ AlertDialog), and **Move to…**
  (the accessible / touch status-change path, the keyboard-and-pointer equivalent of drag). This
  **replaces the always-visible per-card Edit/Delete buttons** the audit flagged as heavy repeated
  chrome — the actions collapse into one quiet control.
- **Meta row** — the **due date** (`caption`, `muted-foreground`, `calendar-blank` glyph), flipping
  to the `destructive`-soft foreground at weight 600 with the `clock` glyph when **overdue**; then,
  pushed to the inline-end, the **assignee Avatar stack** (initials on `accent`, overlapped with a
  `card`-coloured hairline between them) **or**, when unassigned, the **Backlog** chip
  (`warning`-soft, `tray` glyph).
- **Done card** — the whole card dims to ~55–60% opacity and shows the **completed time** in place
  of the due date (`check-circle` glyph), with **no strikethrough** (which reads as harsh —
  principle 4). Status column membership carries the rest of the signal.

Because the lane already names the status, the card carries **no** standalone status chip — the
column is the status. Status change is drag (between lanes) with the overflow **Move to…** menu as
the accessible fallback; this is where `components.md`'s StatusControl behaviour lives on this
surface.

## Create / edit sheet (TaskFormSheet)

The manager/admin create-and-edit form, per `components.md` §TaskFormSheet, built on the **Sheet**
primitive. **Anchoring graduates the DS's "Sheet is bottom-anchored" default into a responsive
rule** (a decision this flagship makes explicit for the build): a **bottom Sheet on mobile** (thumb
zone, drag handle, `radius-xl` leading corners) and an **inline-end drawer on desktop** (`min(30rem,
…)` wide, leading-corner `radius-xl`, over a scrim) — a bottom sheet rising the full height of a wide
monitor reads wrong, and a side drawer keeps the board visible beside the form. Both are the same
Sheet contents.

Contents (Field-wrapped primitives, `components.md`):

- **Title** — Input (`dir="auto"`).
- **Description** — Textarea (grows a few lines then scrolls).
- **Priority** — Select (`low` / `normal` / `high`).
- **Status** — Select (`not started` / `in progress` / `done`); **edit only** — a new task always
  starts `not_started` server-side, so create offers no status.
- **Location** — Select; **admin-on-create only** (the board an admin creates on; a manager's own
  location is implied). Rendered in the spec, noted in the mockup; switching it clears picked
  assignees (the assignee-location invariant, ADR-0007).
- **Due date** — a date Input (`calendar-blank`).
- **Assignees** — a checkbox multi-select constrained to **active users at the task's location**;
  leaving all unchecked is legitimate and keeps the task in the backlog (a `hint` states this).
- **Footer** — a `primary` **Save/Create** and a `secondary` **Cancel** in the thumb zone; **edit**
  additionally carries a **Delete** (outline-`destructive` with the `trash` glyph, pushed to the
  inline-end) routing through an **AlertDialog**.

## Display states

The board's own display states (`components.md` §TaskBoard), rendered in the states frame:

- **Empty** — a `tray` glyph, a short warm line ("No tasks yet" / "Create the first task for this
  location."), and, for a manager/admin, one `primary` **New task** call to action.
- **Loading** — **Skeleton** cards shaped like real TaskCards (title bar + a chip + a meta line),
  a `muted` surface with a gentle shimmer removed under `prefers-reduced-motion`; never a bare
  spinner. `aria-busy` on the region.
- **Error** — a `warning` glyph, a plain statement ("Couldn't load the board" / "Check your
  connection and try again."), and an `outline` **Try again** affordance (principle 4: say what to
  do next, no apology).

A failed reorder surfaces as an inline `destructive` Alert above the board (the shipped board's
behaviour), not a state screen; noted for the build, not drawn here.

## RTL / LTR

Every region uses **logical properties**, so the RTL-canonical layout is the source and LTR is the
automatic mirror: the side nav and the drawer sit at the **inline-start** / **inline-end**
respectively in both directions, the kanban columns keep their order, and the card grip/menu swap
sides with direction. No directional icon is new to this surface (the board's glyphs — status,
priority, due, backlog, drag, edit, delete — are all universal); the only directional roles in view
are the shell's (`sign-out`). Authored content (task titles, assignee names) is bidi-isolated with
`dir="auto"` so it keeps its own script inside chrome of the opposite direction.

## DS component & token mapping

| Region | Composes (`components.md`) | Key tokens / icons |
|---|---|---|
| Content-header | Button (`primary` New task, `outline` Sort), Input (Search) | `heading-lg`, `input`, `primary`, `--bb-content-wide`; `create`, `search` |
| Status lane | new composition (section + col-head) | `muted` tray, `radius-lg`, `foreground`/`muted-foreground`; `circle`/`circle-half`/`check-circle` (status), tabular count |
| TaskCard | TaskCard + StatusControl (via overflow) + Avatar + Badge | `card`, `border`, `radius-lg`, `elevation-sm`, `heading-sm`; `dots-six-vertical`, `dots-three`, `warning` (high), `calendar-blank`/`clock` (due/overdue), `tray` (backlog), `accent` (avatars) |
| Priority / status / backlog chips | Badge (soft variants) | `warning-muted` (high, backlog), `muted` (low), `accent`/`success-muted` (status, in lane heads) |
| Create/edit sheet | Sheet, Field, Input, Textarea, Select, AlertDialog | `card`/`popover`, `input`, `radius-xl`, `elevation-lg`, `primary`/`secondary`/`destructive`; `x` (close), `caret-down` (select), `calendar-blank`, `check` (assignee), `trash` (delete) |
| States | Skeleton, Button, Alert | `muted` (skeleton), `warning`/`destructive`-soft; `tray` (empty), `warning` (error), `plus` (CTA) |

## Icon roles used (registry, `iconography.md`)

`create` (plus), `search`, `tasks` (list-checks), `dots-six-vertical` (drag), `dots-three`
(overflow), `priority-high` (warning), `due` (calendar-blank), `overdue` (clock), `backlog` (tray),
status `circle` / `circle-half` / `check-circle`, `edit` (pencil-simple), `delete` (trash), `close`
(x), `caret-down` (select disclosure), `check` (selected assignee), plus the shell's nav/account
roles. `fill` weight stays reserved for the active nav destination (shell) and a current
StatusControl selection; the board's resting glyphs are all `regular`.

## Breakpoint summary

| Width | Header | Board | Create/edit |
|---|---|---|---|
| `< 768` (mobile) | title + Sort + FAB (shell) | stacked status sections, cap 30rem | bottom Sheet |
| `768–1023` (md) | title + Search + Sort + New task | one wide column of status sections, cap 70rem | inline-end drawer |
| `≥ 1024` (lg) | title + Search + Sort + New task | **3-column status kanban**, muted lanes | inline-end drawer |

## What this fixes from the #174 audit

- **X1 / X2 / X3** (marooned column, stranded tab-bar, inset unbranded header) — inherited from the
  shell (#175); the board simply composes inside it.
- **X4** (single-column desktop density) — the kanban spends the width across three lanes.
- **Per-card Edit/Delete chrome** (Task board — Manager finding) — collapsed into the card's
  overflow menu.
- **X5** (raw native `<select>`s) — the create/edit form uses the DS **Select** for priority,
  status, and location.

## Notes for the fan-out screens

- Copy this file's parent harness (the shell's `mockup.html` `<head>` — token CSS, font `@font-face`,
  the Phosphor sprite, the device-frame + toggle scaffold) so every screen renders as one system.
- This screen adds five glyphs to the sprite the shell shipped — `dots-six-vertical`, `tray`,
  `pencil-simple`, `trash`, `check` — all already in the `iconography.md` registry; later screens
  inherit them.
- Two decisions this flagship makes that later screens and the build should honour or revisit: the
  **kanban drag = set status** behavioural change (board-feature scope), and the **Sheet →
  inline-end drawer on desktop** responsive anchoring. Both are flagged above, not buried.
