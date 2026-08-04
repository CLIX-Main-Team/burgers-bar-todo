# People management screen — mockup · spec

The manager / admin **people surface** (map #173, ticket #179): the invite roster and the invite
form, applied to the decided shell and matched to the flagship's language. It is a **fan-out
screen** — it inherits the shell, the card/overflow anatomy, and the Sheet→drawer anchoring from the
task board, and spends its own decision on the one thing people needs that the board didn't: a
**desktop table** dense enough to read a whole chain's roster at a glance.

Read `docs/design-system/principles.md`, `tokens.md`, `components.md`, and `iconography.md` first,
the shell spec `../shell/spec.md` second, and the flagship `../task-board/spec.md` third — this spec
names their roles and never restates their values, and it draws all chrome (side nav,
content-header, content frame, Sheet primitive) from them. The companion `mockup.html` is the visual
truth: it starts from the flagship's harness (the same token CSS, embedded Assistant variable font,
and Phosphor `<symbol>` sprite) and renders the roster at **mobile / tablet / desktop**, in **RTL
(Hebrew, canonical) and LTR (English)**, in **light and dark**, plus the **invite Sheet (mobile) /
drawer (desktop)**, the **manager view**, and the **empty / loading / error** states.

## The composition decision (this ticket)

The desktop roster is a **table grouped by status**; the mobile/`md` roster is a **stacked list of
person cards**. This is the direct answer to the #174 audit's **X4** on this screen ("the invite
form and the person list stack in a marooned narrow column when a proper **table** would use the
width and cut the scrolling").

The flip mirrors the flagship exactly: the board is *stacked status sections → 3-column kanban at
`lg`*; people is *stacked status sections of cards → one status-grouped table at `lg`*. Two shells,
not three — the table does **not** force at `md` (the tight ~500px content area keeps the card list),
it appears at `lg` where the width pays for columns.

**The table is grouped by status, so it carries no Status column** — the group header row names the
status, exactly as the flagship's lane names it and the card drops its status chip. The group is the
status. (The **mobile card keeps** a small status chip: a card scrolled far from its section header
still needs to say what it is; a table row never leaves its group header's sightline. A
width-and-interaction-driven divergence, not an inconsistency.)

## What this fixes from the #174 audit (people-specific)

- **Raw Location UUIDs exposed to users** (the screen's headline defect — every card printed
  `Location: 44444444-…` and the invite form demanded a typed "Location ID"). The mockup shows
  **named locations everywhere** — `Downtown` / `Airport` / `Harbor` in the list, table, filter, and
  invite picker, and **`Chain-wide`** (muted) for a location-less admin. This is the presentation
  end of the location-management umbrella #163 (L3 already rewired the invite form to a name picker,
  PR #190); the mockup carries the same treatment into the **roster read**.
- **X5 — raw native `<select>`s** (Role, Filter-by-location). Replaced by the DS **Select** in the
  invite form and a DS filter control in the content-header.
- **Always-open invite-form card occupying prime real estate above the list.** Collapsed into an
  **Invite someone** action that opens the invite as a **Sheet / drawer** (below), freeing the whole
  frame for the roster.
- **Per-row Deactivate / Resend / Revoke buttons.** Collapsed into a per-row **overflow menu**
  (iconography.md already files resend/revoke/deactivate under a "people DropdownMenu"), the same
  quiet control the flagship card uses.
- **X1 / X2 / X3** (marooned column, stranded tab-bar, inset unbranded header) — inherited from the
  shell (#175); people composes inside it.

## Layout regions

The screen renders into the shell's **content-inner** (capped `--bb-content-max` on mobile,
`--bb-content-wide` on desktop, centred). It draws its own **content-header** and **roster body**;
it never draws chrome.

### Content-header

The shell's content-header pattern: the screen title **People** (`heading-lg`) at the inline-start;
a right-grouped action cluster at the inline-end holding, in order — a **Search** field (name /
email; `input` border, `--bb-control-height`, `radius-md`; desktop only, per shell), the
**Filter by location** control (**admin only** — a DS Select showing `All locations`; the X5 fix),
and the **Invite someone** `primary` Button (with the `create` plus glyph). On mobile the primary
create action is the shell's **Create FAB** (relabelled "Invite someone"); the header Button is the
desktop replacement, and Search + Filter are desktop-only (shell decision 3 & 4).

### Roster body per breakpoint

| Width | Composition |
|---|---|
| `< md` (mobile) | The three status groups **stacked** as full-width sections (section-head + cards), single column, cap `--bb-content-max`. The audit's "good" mobile list, kept and DS-tightened. |
| `md` (768–1023) | Same stacked card sections, one **wide** column, cap `--bb-content-wide`. No table yet (shell decision 4). |
| `≥ lg` (1024) | The **status-grouped table**: `Person · Role · Location · (actions)`, columns `Invited` → `Active` → `Deactivated` as in-table group-header rows. |

### Status section / group

Both breakpoints order the groups **Invited → Active → Deactivated** (the way a person reasons about
a roster: who is still pending, who is on, who is off — the shipped `SECTIONS` order, story 13). Each
group carries a glyph (`paper-plane-tilt` invited / `check-circle` active / `user-minus`
deactivated), its label, and a tabular **count** — and, when empty, an explicit line
("No deactivated people.") so an empty group reads as a state, not a vanished section (the shipped
good behaviour, keep). A **deactivated** card/row dims to ~55–60% opacity (the same treatment the
flagship gives a done card — the group already carries the rest of the signal; no strikethrough,
principle 4).

## PersonCard (mobile / `md`)

Built on the DS **Card**, tuned like the flagship's TaskCard for a person:

- **Avatar** (initials on `accent`; the acting user's own row on `primary`, `av--me`) at the
  inline-start of the card-top.
- **Identity** — display name (`heading-sm`/600, `dir="auto"` so a Hebrew name reads correctly
  inside an English UI and vice-versa) over the email (`caption`, `muted-foreground`, truncating).
- **Overflow menu** (`dots-three` ghost icon Button, hit area padded to `--bb-touch-min`) at the
  inline-end — the row's DropdownMenu (contents below).
- **Meta row** — the **status Badge** (soft: `warning` invited / `success` active / `muted`
  deactivated, the shipped `statusChip` mapping) then the **role** (`Employee` / `Manager` / `Admin`)
  and, **admin only**, the **location** name (`· Downtown`, or `· Chain-wide`). A manager's list is a
  single location, so the location is dropped as redundant (stories 8, 10).

## People table (`lg`)

A `<table>`, `Person · Role · Location · actions`, grouped by status via in-table **group-header
rows** (glyph + label + count, spanning the columns). Rows:

- **Person** cell — the same Avatar + name-over-email as the card, denser.
- **Role** cell — `Employee` / `Manager` / `Admin` (plain, the column names the dimension). Role is
  held apart from the status family; it is never a coloured chip competing with status.
- **Location** cell — the named location, or **`Chain-wide`** in `muted-foreground` for a
  location-less admin. **Admin only** — the manager table drops the column (single location).
- **Actions** cell (inline-end) — the row **overflow menu** (`dots-three`), the accessible,
  low-chrome home for the row actions.

The mockup renders one row's menu **open** to show its shape; a resting row shows only the quiet
trigger.

### Row actions (overflow DropdownMenu)

Scoped to the acting principal, mirroring the API's action scope so the UI never offers a
guaranteed-rejection control (ADR-0007; the shipped `canActOnInvite` / admin gating):

- **Invited** → **Resend invite** (`arrow-clockwise`) and **Revoke invite** (`prohibit`,
  `destructive`). Shown on an invite the principal may act on: an admin reaches any invite, a manager
  only an **employee** invite.
- **Active** → **Deactivate** (`user-minus`, `destructive`) — **admin only**, routing through an
  **AlertDialog** confirm (per iconography.md; the destructive-confirm pattern, not drawn open
  here). Never on the acting admin's own row.
- **Deactivated** → **Reactivate** (`arrow-clockwise`) — **admin only**.

A failed row action surfaces as inline `destructive` text on the row (the shipped behaviour), not a
state screen; noted for the build, not drawn.

## Invite form (Sheet / drawer)

The invite form, built on the **Sheet** primitive, **graduating the DS "Sheet is bottom-anchored"
default into the same responsive rule the flagship set**: a **bottom Sheet on mobile** (thumb zone,
drag handle, `radius-xl` leading corners) and an **inline-end drawer on desktop** (`min(30rem, …)`
wide, leading-corner `radius-xl`, over a scrim) so the roster stays visible beside the form. Both
are the same Sheet contents; it opens from the header **Invite someone** Button (desktop) or the FAB
(mobile).

Contents (Field-wrapped primitives, `components.md`), constrained by the acting principal exactly as
the shipped `InviteForm` (ADR-0007) — the form only ever offers what the API will accept:

- **Email** — Input (`type=email`).
- **Display name** — Input (`dir="auto"`).
- **Role** — Select (`Employee` / `Manager` / `Admin`); **admin only**. A **manager** sees no role
  chooser — an `info` Alert states the fixed remit ("Managers invite employees to their own location
  only — role and location are fixed") in place of the Role and Location controls.
- **Location** — Select over the **named** location list; shown for an admin choosing a *located*
  role. Choosing **Admin** (a location-less admin) hides it; when **no location exists yet**, an
  `info` Alert prompts creating one first, linking `/locations` (decision 7 — never an empty,
  un-submittable picker). *(These two conditional states are described here and carried by the build;
  the mockup renders the common admin-invites-employee path.)*
- **Footer** — a `primary` **Send invite** (with the `send` paper-plane glyph) and a `secondary`
  **Cancel** in the thumb zone. On success the shipped form shows a `success` Alert ("Invite sent to
  …") and resets; on 409 / 403 / network it shows the matching `error` Alert (build behaviour,
  noted).

## Role-based views (the two audiences)

The list scope is derived server-side from the principal, never requested (ADR-0007); what differs
is **presentation**:

- **Admin** (the canonical rendering) — the full surface: Location column, Location **filter**, the
  role chooser on invite, and **Deactivate / Reactivate** actions across every location.
- **Manager** — a **single-location** surface: **no Location column and no filter** (the same value
  on every row is noise), invite **fixed to employee at their own location** (the `info` Alert, no
  role/location choosers), row actions limited to **Resend / Revoke on employee invites** (no
  Deactivate), and a side nav **without the admin-only Locations row**. Rendered as its own frame.

## Display states

Rendered in the states frame, matching the flagship's set:

- **Empty** — a `manage-users` glyph, a warm line ("No one here yet" / "Invite your first teammate
  to this location."), and one `primary` **Invite someone** call to action.
- **Loading** — **Skeleton** rows shaped like real person rows (avatar circle + a name line + a
  short line), a `muted` shimmer removed under `prefers-reduced-motion`; never a bare spinner.
  `aria-busy` on the region.
- **Error** — a `warning` glyph, a plain statement ("Couldn't load people" / "Check your connection
  and try again."), and an `outline` **Try again** affordance (principle 4).
- **Empty group** — the inline "No deactivated people." line inside a present section (kept from the
  shipped screen).

## RTL / LTR

Every region uses **logical properties**, so RTL-canonical Hebrew is the source and LTR the
automatic mirror: the side nav sits inline-start, the invite **drawer** inline-end, and the table's
Person column leads at inline-start with the actions at inline-end, in both directions. No directional
icon is new to this surface (status, role, resend/revoke/deactivate glyphs are all universal); the
only directional role in view is the shell's `sign-out`. Names and emails are bidi-isolated with
`dir="auto"` so a Hebrew name keeps its script inside an English UI and vice-versa.

## DS component & token mapping

| Region | Composes (`components.md`) | Key tokens / icons |
|---|---|---|
| Content-header | Button (`primary` Invite), Input (Search), Select (Filter) | `heading-lg`, `input`, `primary`, `--bb-content-wide`; `create`, `search`, `manage-locations`, `caret-down` |
| Status section / group | new composition (section-head / table group-row) | `muted` count pill, `foreground`/`muted-foreground`; `paper-plane-tilt`/`check-circle`/`user-minus`, tabular count |
| PersonCard | Card + Avatar + Badge + DropdownMenu (overflow) | `card`, `border`, `radius-lg`, `elevation-sm`, `heading-sm`; `accent`/`primary` (avatar), `warning`/`success`/`muted`-soft (status), `dots-three` |
| People table | new composition + Avatar + DropdownMenu | `card`, `border` (row rule), `muted` (hover); `dots-three` |
| Row menu | DropdownMenu (+ AlertDialog for deactivate) | `popover`, `border`, `radius-md`, `elevation-lg`, `destructive`; `arrow-clockwise` (resend/reactivate), `prohibit` (revoke), `user-minus` (deactivate) |
| Invite Sheet / drawer | Sheet, Field, Input, Select, Alert, Button | `card`, `input`, `radius-xl`, `elevation-lg`, `primary`/`secondary`; `x` (close), `caret-down` (select), `send` (submit), `accent` (info Alert) |
| States | Skeleton, Button, (Alert) | `muted` (skeleton), `success`/`warning`-soft; `manage-users` (empty), `warning` (error), `create` (CTA) |

## Icon roles used (registry, `iconography.md`)

`create` (plus), `search`, `manage-users` (users), `manage-locations` (storefront), `caret-down`,
`dots-three` (overflow), status-section `paper-plane-tilt` / `check-circle` / `user-minus`,
`resend-invite` (arrow-clockwise), `revoke-invite` (prohibit), `deactivate-user` (user-minus),
`send` (paper-plane-tilt), `close` (x), plus the shell's nav / account roles. `fill` weight stays
reserved for the active nav destination (shell). **Three glyphs are new to the sprite** —
`arrow-clockwise`, `prohibit`, `user-minus` — all already in the `iconography.md` registry; later
status-and-people screens inherit them.

## Breakpoint summary

| Width | Header | Roster | Invite |
|---|---|---|---|
| `< 768` (mobile) | title + FAB (shell) | stacked status sections of cards, cap 30rem | bottom Sheet |
| `768–1023` (md) | title + Search + Filter + Invite | one wide column of card sections, cap 70rem | inline-end drawer |
| `≥ 1024` (lg) | title + Search + Filter + Invite | **status-grouped table**, cap 70rem | inline-end drawer |

## Notes carried to the build

- This screen adds **three** glyphs to the sprite (`arrow-clockwise`, `prohibit`, `user-minus`); all
  are in the registry.
- The **named-location** treatment across the roster read is the presentation the audit asked for;
  it depends on the roster response carrying a resolvable location **name**, not only the id the
  shipped `UserSummary` returns today (the invite form already reads the name list via `useLocations`
  — the *list* row should read the same source). Flagged, not smuggled.
- Row actions move from **always-on buttons** to an **overflow DropdownMenu** (with the deactivate
  AlertDialog confirm) — a small interaction change the build owns, consistent with the flagship card.
