# Iconography

The UI icon system of the Burgers Bar staff-app design system: the icon library, the wrapper and
registry that address it, the RTL / colour / weight / size / accessibility conventions, and the
complete role→glyph mapping every surface draws from. Decided in the iconography map (#142) — the
candidate survey (#143), the in-brand head-to-head prototype (#144), and the pick that locked it
(#145) — and recorded in [ADR-0020](../adr/0020-iconography-phosphor-role-registry.md), which
governs this document.

Read principles.md first. This document inherits its RTL/LTR conventions (directional icons mirror,
universal ones do not), its accessibility bar (the 44px touch floor, visible focus, WCAG 2.2 AA),
and its Hebrew-first, retheme-not-redesign stance.

This is the **UI glyph** system — tab-bar destinations, send, close, chevrons, the password toggle,
task-status marks, priority and toast affordances. The bespoke **brand mark** (app/PWA icon,
favicon, wordmark, assistant mark) is a separate, already-built concern owned by the brand-identity
umbrella (#103, ADR-0016); these icons sit alongside it and do not replace it.

## Library

**Phosphor** — `@phosphor-icons/react`, MIT — is the icon library. Its warm, rounded terminals fit
the cream-and-gold brand and the humanist Assistant type face, and its `regular → fill` weight axis
gives the active/selected state a real second signal beyond colour. The rationale, and the
finalists it beat (Lucide, Tabler), are in ADR-0020.

Icons are consumed as an **npm package via tree-shaken named imports** —
`import { PaperPlaneTilt } from '@phosphor-icons/react'` — not a copied SVG set and not a sprite,
both of which would discard the runtime weight axis and the directional-mirror prop the library was
chosen for. `apps/web` is a client SPA with no SSR, so named imports tree-shake cleanly.

## The `<Icon>` wrapper and the role registry

Call sites **never** import a Phosphor glyph name. They address icons by semantic **role**:

```tsx
<Icon name="send" />
<Icon name="tasks" size="lg" />
<Icon name="priority-high" label={t('priority.high')} />
```

A single **role registry** module is the source of truth. It maps each role to its glyph, its
directional flag, and its default weight — so the mapping table below is live code, and
directionality is *data* the wrapper enforces, not a per-call flag a call site can forget. Sketch:

```ts
// role -> { glyph, directional?, defaultWeight? }
const ICON_REGISTRY = {
  send:  { glyph: PaperPlaneTilt, directional: true },
  tasks: { glyph: ListChecks },           // weight flips to fill via the active prop
  close: { glyph: X },
  // ...all 39 roles
} as const
```

The wrapper owns RTL mirroring, sizing, colour inheritance, and accessibility once, so no call site
re-implements them. Swapping the library, or changing a role's glyph, is a **registry** edit — never
a call-site sweep.

## Conventions

### RTL mirror

Directional icons mirror in RTL; universal icons do not (principle 2). The wrapper tags directional
roles with an `icon--directional` class, and a single CSS rule drives the flip off the ambient
direction — the `dir="rtl"` that `LocaleProvider` already stamps on `<html>`:

```css
[dir="rtl"] .icon--directional { transform: scaleX(-1); }
```

The wrapper stays purely presentational — no locale-context subscription, no re-render on language
switch. Phosphor's first-party `mirrored` prop is the **sanctioned alternative** (identical
`scaleX(-1)` under the hood); the CSS route is preferred so the flip need not pass through JS.

The four directional roles: **back** (`arrow-left`), **row-forward / next** (`caret-right`),
**send** (`paper-plane-tilt`), **log out** (`sign-out`). Everything else is universal and stays put.

### Colour

Colour is `currentColor`, inheriting the surrounding `foreground` / `*-foreground` token. The
wrapper takes **no** `color` prop — an icon is the colour of the text it sits in. On a `primary`
surface it is `primary-foreground`; in body text it is `foreground`; priority-high is painted in
warning-soft by its surrounding badge, not by an icon colour prop.

### Weight

Two weights only. Every icon is **`regular`** at rest. **`fill`** is reserved as the active/selected
signal and fires in exactly two places:

1. the **active BottomNav destination** (outline → solid under the gold primary dot), and
2. the **current task status** in a StatusControl / Badge (the selected status solid; the others
   stay `regular`).

Everything else stays `regular` — priority, toasts, chrome. No thin / light / bold / duotone.
Reserving `fill` the way the system reserves gold for one primary action keeps the weight jump
meaningful.

### Size

Named sizes, each a Tailwind step, default `md`:

| Name | px | Tailwind | Used for |
|---|---|---|---|
| `sm` | 16 | `size-4` | inline with caption / metadata text |
| `md` | 20 | `size-5` | **default** — buttons, menu items, status badges |
| `lg` | 24 | `size-6` | BottomNav, avatar fallback, largest touch targets |

Visual size is decoupled from the 44px hit area, which the **button** owns (tokens.md touch
targets) — a `sm` or `md` glyph still lives inside a 44px tap target. `1em` (inherit text size) is
available as an escape hatch, not the default.

### Accessibility

Decorative by default: the wrapper renders `aria-hidden="true"`, and the accessible name comes from
the surrounding control. Icon-only buttons (close, send, password toggle, resend / revoke) carry
`aria-label` on the **button**; the glyph stays hidden so it is not double-announced. For a
standalone meaningful glyph with no surrounding label, the optional **`label`** prop flips it to
`role="img"` + `aria-label` and drops `aria-hidden`.

## Role → glyph mapping

The complete inventory: 39 roles, 4 directional (marked ⇄). This table is the registry's contents.

### Navigation & chrome

| Role | Surface | Dir | Glyph | Weight |
|---|---|:--:|---|---|
| Tasks destination | BottomNav | | `list-checks` | regular → **fill** when active |
| Assistant destination | BottomNav | | `chat-circle-dots` | regular → **fill** when active |
| Create / add / invite | FAB, invite, new-thread | | `plus` | regular |
| Account avatar (fallback) | AppHeader | | `user-circle` | regular |
| Back | sub-screens | ⇄ | `arrow-left` | regular |

### Account menu

| Role | Surface | Dir | Glyph |
|---|---|:--:|---|
| Profile | AvatarMenu | | `user-circle` |
| Light theme | Theme toggle | | `sun` |
| Dark theme | Theme toggle | | `moon` |
| Language | LanguageToggle | | `translate` |
| Settings | AvatarMenu | | `gear` |
| Manage users | AvatarMenu / people | | `users` |
| Log out | AvatarMenu | ⇄ | `sign-out` |

### Menus, sheets & disclosure

| Role | Surface | Dir | Glyph |
|---|---|:--:|---|
| Close (sheet / dialog) | Sheet, Dialog | | `x` |
| Selected / checked row | DropdownMenu, StatusControl | | `check` |
| Disclosure (Select) | Select trigger | | `caret-down` |
| Row forward / next | list rows | ⇄ | `caret-right` |

### Task board

| Role | Surface | Dir | Glyph | Weight |
|---|---|:--:|---|---|
| Status: not started | StatusControl / Badge | | `circle` | regular → **fill** when current |
| Status: in progress | StatusControl / Badge | | `circle-half` | regular → **fill** when current |
| Status: done | StatusControl / Badge | | `check-circle` | regular → **fill** when current |
| Priority: high | TaskCard Badge | | `warning` | regular (warning-soft) |
| Due date | TaskFormSheet | | `calendar-blank` | regular |
| Overdue | TaskCard meta | | `clock` | regular |
| Backlog / unassigned | TaskCard chip | | `tray` | regular |
| Edit task | TaskFormSheet | | `pencil-simple` | regular |
| Delete / deactivate | AlertDialog actions | | `trash` | regular |
| Drag to reorder | TaskBoard | | `dots-six-vertical` | regular |

### Assistant

| Role | Surface | Dir | Glyph |
|---|---|:--:|---|
| Send message | Composer | ⇄ | `paper-plane-tilt` |
| Threads / history | ThreadList | | `chats-circle` |
| New thread (compose) | ThreadList | | `note-pencil` |
| Knowledge-doc chip | ChatBubble attribution | | `file-text` |
| Grounded refusal note | ChatBubble | | `info` |

### Auth & people

| Role | Surface | Glyph |
|---|---|---|
| Show password | PasswordField | `eye` |
| Hide password | PasswordField | `eye-slash` |
| Resend invite | people DropdownMenu | `arrow-clockwise` |
| Revoke invite | people DropdownMenu | `prohibit` |
| Deactivate user | people AlertDialog | `user-minus` |

### Feedback (toast)

| Role | Surface | Glyph |
|---|---|---|
| Toast: success | Toast | `check-circle` (regular) |
| Toast: error | Toast | `warning-circle` (regular) |
| Retry | Toast / error states | `arrow-clockwise` |

**Two judgment calls** settled in #145 and preserved here: `sign-out` stays **directional** (its
arrow points toward the reading-exit, so flipping keeps it honest in RTL), and priority-high stays
`warning` rather than `flag` (token coherence — it is painted in warning-soft, and the triangle is
kept distinct from the error toast's `warning-circle`).

## How to add an icon

1. **Pick the role, not the glyph.** Name the semantic job (`overdue`, `resend-invite`), not a
   Phosphor name. If an existing role fits, reuse it.
2. **Choose the Phosphor glyph** from [phosphoricons.com](https://phosphoricons.com), matching the
   warm-rounded family already in use.
3. **Add one registry row:** `role → { glyph, directional?, defaultWeight? }`. Set `directional:
   true` only if the glyph carries a reading direction (see principle 2); leave it off for universal
   glyphs.
4. **Never** `import` the glyph at the call site — render `<Icon name="your-role" />`. Reach for
   `size` only to override the `md` default; reach for `label` only for a standalone meaningful glyph
   with no surrounding accessible name.
5. **Do not add a weight** unless the role is an active/selected state — `fill` is reserved (see
   Weight above).
6. If the addition is a whole new family of roles, update the mapping table above in the same change.
