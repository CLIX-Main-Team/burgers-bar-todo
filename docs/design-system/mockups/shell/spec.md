# Responsive app shell & navigation — spec

The canvas every v1 screen composes on: how the app chrome transforms from phone to
desktop. This is the first screen mockup (map #173, ticket #175) and the reference the
other screens inherit — the flagship task board (#176), the employee view (#177), the
assistant (#178), people (#179), and auth (#180) all render **inside** this shell.

Read `docs/design-system/principles.md`, `tokens.md`, `components.md`, and
`iconography.md` first — this spec names their token roles, component names, and icon
roles and never restates their values. The companion `mockup.html` is the visual truth:
self-contained, in the real DS tokens, the embedded Assistant variable font, and actual
Phosphor glyphs, rendered at **mobile / tablet / desktop**, in **RTL (Hebrew, canonical)
and LTR (English)**, and in **light and dark**.

## The scope decision this shell rests on

`tokens.md` ("Breakpoints and layout width") deliberately ruled a genuine desktop layout
**out of scope for v1**: the app is one phone-first column capped at `--bb-content-max`
(30rem) and centred on wide screens. The #174 audit found that exact centred column is
the "doesn't look good on web" problem — every in-app screen reads as a marooned phone
screenshot with a stranded bottom tab-bar.

Map #173 consciously **overrides that one scope line**: it invents the desktop shell the
DS never drew. This is an *addition* to the design system, not a redesign of it — every
token, component, and icon below is used exactly as specified. The phone shell is
unchanged; the desktop shell is net-new. When this mockup set is built, `tokens.md`'s
breakpoint section should be amended to point at this shell rather than at the capped
column (a `/to-spec` + build concern, noted here so it is not lost).

## The four decisions (locked in #175)

1. **Role-aware side nav.** On desktop the bottom tab-bar becomes a persistent side nav
   that carries the everyday destinations **plus** the role-gated admin surfaces that are
   buried in the account menu today: Tasks, Assistant, then People (managers/admins) and
   Locations (admins). Identity, theme, language, and log out live in an account block at
   the **foot** of the nav. Mobile is unchanged — still exactly two role-invariant tabs
   (Tasks, Assistant, PRD story 6); the promotion happens only where the vertical nav has
   room, so the PRD's thumb-zone constraint is never violated.
2. **Labeled nav, ~240px** (`--bb-sidenav`, 15rem). Icon + text label per item, always
   visible — no hover-to-reveal rail. This matches the occasional-user framing
   (principles.md operating context), comfortable density, the no-hover-primary rule, and
   keeps Hebrew labels legible.
3. **Wide, capped, centred content.** The content region beside the nav gets a wide cap —
   `--bb-content-wide`, 70rem (~1120px) — and centres in the leftover space so ultrawide
   monitors don't stretch a table edge to edge. Screens compose their own columns *inside*
   this frame; reading-heavy screens (the assistant) keep a narrower measure within it.
4. **Shell flips at `md` (768px); content compositions flip at `lg` (1024px).** The
   chrome transform (bottom-bar → side nav) happens at `md` so landscape tablets get the
   desktop shell. To keep the tight ~500px content area at `md` clean, multi-column
   *content* (the board's status columns, the people table) does **not** force until `lg` —
   at `md` the content is a single wide column. Two shells to build, not three.

## Layout regions

### Mobile shell (`< md`, `< 768px`)

Unchanged from the built shell (`apps/web/src/shell`). Top to bottom:

- **AppHeader** — `card`-surface bar, `border` underline, top safe-area inset
  (`env(safe-area-inset-top)`). App name (wordmark) at inline-start, account **Avatar**
  button at inline-end (opens the AvatarMenu bottom Sheet — components.md). Read, not
  primary action (principle 1). In flow, never moving: the content region below is the
  shell's scroll container.
- **Content** — the shell's one scroll region (the same model as the desktop shell,
  unified 2026-08 for the assistant's pinned composer): a single column, edge margins
  `space-md`, capped at `--bb-content-max` (30rem) and centred, per the DS. The shell
  pins to the viewport height, so header and BottomNav never move while the content
  scrolls between them.
- **Create FAB** — round `primary` Button in the bottom-inline-end thumb zone, above the
  BottomNav; managers/admins only, hidden on the Assistant screen (components.md).
- **BottomNav** — in flow at the shell's bottom edge, `card` surface, `elevation-sm`, bottom safe-area inset
  (`env(safe-area-inset-bottom)`). Two destinations, Tasks and Assistant; active carries
  the `accent-foreground` label + gold `primary` dot + `fill`-weight icon (iconography.md).

### Desktop shell (`≥ md`, `≥ 768px`)

A two-region CSS-grid/flex row — **side nav** (fixed `--bb-sidenav`) beside a **content**
region (`1fr`). No top header bar and no FAB: the side nav owns brand + account, and each
screen's own content-header owns the primary action.

- **SideNav** — `card` surface, `border` inline-end divider. Three stacked zones:
  - *Brand lockup* (top): the brand mark tile (`primary` ground, `primary-foreground`
    letter) + wordmark. Uses the existing brand assets (ADR-0016), not redrawn here.
  - *Nav list*: one row per destination, `--bb-control-height` (48px) tall, `radius-md`,
    icon + label. Role-gated rows (People, Locations) render only for the permitted role
    and carry a small muted gate chip in the mockup purely to annotate who sees them — the
    chip is **not** shipped UI, gating is presentation-only over the API's own authorization
    (ADR-0007).
  - *Account foot* (bottom, pushed with `margin-block-start:auto`, `border` top divider):
    an **AvatarMenu** trigger showing the account Avatar, display name + role, and a gear.
    On desktop this opens as an anchored popover/menu rising from the foot (the desktop
    equivalent of the mobile bottom Sheet); it carries the same items — Profile, the
    Theme and Language segmented toggles, Settings, Log out (destructive row).
- **Content** — a scroll region holding one **content-inner** capped at
  `--bb-content-wide` (70rem) and centred, padding `space-xl space-lg space-2xl`.
  - *Content-header*: the screen title (`heading-lg`) at inline-start; a right-grouped
    action cluster (a Search field, `--bb-control-height`, `input` border, `radius-md`; and
    the screen's `primary` create Button) at inline-end. This is where the create action
    lives on desktop, replacing the mobile FAB.
  - *Content-body*: the screen's own composition. Single wide column at `md`; the board
    fans to a 3-column CSS grid (`Not started` / `In progress` / `Done`) at `lg`.

## Navigation states

- **Active destination** — `accent` surface + `accent-foreground` label, a gold `primary`
  3px inline-start marker bar, and the destination icon at `fill` weight (the second,
  non-colour active signal reserved by iconography.md). `aria-current="page"` is stamped
  on the active row.
- **Hover** — `accent` surface (desktop pointer affordance; not the primary feedback).
- **Focus-visible** — the `ring` token (bronze on light, gold on dark), never removed.
- **Account foot hover** — `muted` surface.

## RTL / LTR

Hebrew/RTL is canonical; the mockup renders Hebrew by default with an LTR/English toggle.
Every region is laid out with **logical properties** (`inline-size`, `inset-inline-*`,
`border-inline-end`, `margin-inline`, `padding-inline`), so a single definition mirrors:
the side nav sits at the **inline-start** — the **right** in Hebrew, the **left** in
English — with no direction-specific CSS. The nav order (Tasks, Assistant, People,
Locations) is preserved in both directions. Directional icons flip via the wrapper's
`icon--directional` rule (iconography.md): here, **log out** (`sign-out`) in the account
menu. User-authored content (task titles, names) stays bidi-isolated in its own direction.

## Safe areas

The mobile shell keeps the top and bottom `env(safe-area-inset-*)` padding on the header
and BottomNav (notch and home-indicator). The desktop shell needs neither, but the insets
resolve to zero on desktop and are harmless if kept for a single shared frame.

## DS component & token mapping

| Shell region | Composes (components.md) | Key tokens |
|---|---|---|
| SideNav | new composition over Button (ghost rows) + Avatar + the AvatarMenu items | `card`, `border`, `accent`/`accent-foreground`, `primary`, `radius-md`, `--bb-sidenav`, `--bb-control-height` |
| Account foot | AvatarMenu (Sheet on mobile / anchored menu on desktop) + Avatar + LanguageToggle + ThemeToggle | `card`/`popover`, `muted`, `destructive` (log out) |
| AppHeader (mobile) | AppHeader | `card`, `border`, `foreground` |
| BottomNav (mobile) | BottomNav | `card`, `accent-foreground`, `primary`, `elevation-sm` |
| Create FAB (mobile) | Create FAB (Button) | `primary`/`primary-foreground`, `radius-full`, `elevation-md` |
| Content-header | Button (primary), Input (search) | `heading-lg`, `input`, `primary`, `--bb-content-wide` |
| Content frame | the routed screen | `background`, `--bb-content-max` (mobile) / `--bb-content-wide` (desktop) |

Sample task cards in the content body are **placeholder** — the TaskCard, StatusControl,
and board grouping are the flagship board's concern (#176). They appear here only so the
shell reads in context; do not treat their exact treatment as spec.

Icon roles used (iconography.md registry): `tasks` (list-checks), `assistant`
(chat-circle-dots), `manage-users` (users), `manage-locations` (storefront), `account`
(user-circle), `create` (plus), settings (gear), `sign-out`, search (magnifying-glass),
plus the placeholder board glyphs.

## Breakpoint summary

| Width | Nav | Header | Content | Board |
|---|---|---|---|---|
| `< 768` (mobile) | BottomNav (2 tabs) + FAB | sticky AppHeader | 1 col, cap 30rem | single list |
| `768–1023` (md) | SideNav (role-aware) | none (nav owns brand/account) | 1 wide col, cap 70rem | single list |
| `≥ 1024` (lg) | SideNav (role-aware) | none | wide, cap 70rem, centred | 3 status columns |

## Notes for the fan-out screens

- Every screen renders into the **content-inner**; it draws its own content-header (title
  + primary action + optional search/filters) and its own body composition. It never
  draws chrome.
- The shell's `<head>` in `mockup.html` — the token CSS, the embedded font `@font-face`
  rules, the Phosphor `<symbol>` sprite, and the device-frame + toggle scaffold — is the
  **shared mockup harness**. Each subsequent screen mockup should start from a copy of it
  so all mockups render as one system. (This graduates the map's "shared mockup harness"
  fog item: yes, extract it — it is this file's preamble.)
- Reading-measure discipline: the assistant thread should cap its text measure *inside*
  the wide content frame rather than filling 70rem, per its `ChatBubble` treatment.
