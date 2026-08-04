# Assistant — screen mockup · spec

A fan-out screen of the mockup set (map #173, ticket #178): the grounded ops-assistant chat,
made concrete inside the decided shell and matching the flagship board's density, hierarchy, and
composition language. It is written to read as the flagship's `spec.md` pattern (`../task-board/spec.md`).

Read `docs/design-system/principles.md`, `tokens.md`, `components.md` (§Assistant — ChatBubble,
Composer, ThreadList), and `iconography.md` first, and the shell spec `../shell/spec.md` second —
this spec names their roles and never restates their values, and it draws its chrome (side nav,
content frame) entirely from the shell. The companion `mockup.html` is the visual truth: it starts
from a copy of the shell's mockup harness (the same token CSS, embedded Assistant variable font, and
Phosphor `<symbol>` sprite) and renders the assistant at **mobile / tablet / desktop**, in **RTL
(Hebrew, canonical) and LTR (English)**, in **light and dark**, plus the **first-run** state, the
**thread Sheet** (mobile), and the **pending / error / grounded-refusal / thread-loading** states.

## The composition decision (locked in #178)

**Desktop promotes the ThreadList from a Sheet to a persistent rail *inside* the content frame;
mobile keeps it a Sheet.** `components.md` §ThreadList specs "opened as a Sheet"; the shipped UI uses
a bottom-sheet drawer at every width. This ticket graduates that to a responsive rule — the
assistant equivalent of the flagship's Sheet→drawer graduation:

- **`≥ lg`**: the content-inner (70rem) becomes a two-column grid — a **~240px (`--bb-sidenav`)
  thread rail** at the inline-start beside the **conversation**. The rail is a `muted`-surface tray
  (`radius-lg`), carrying the **New conversation** `primary` action at its top and the auto-titled
  thread rows below. It sits *within* the content frame (not a third full-height chrome pane beside
  the shell's side nav), so threads read as content the screen composes — per shell decision 3.
- **`< lg`**: no rail. The ThreadList opens as the DS **Sheet** — **bottom-anchored on mobile**
  (drag handle, `radius-xl` leading corners, over a scrim), reached from the **threads icon-button**
  in the mobile in-content header; on **`md`** it is reached from a **Conversations** `outline`
  Button in the content-header (the shell shows the side nav at `md` but content stays single-column
  until `lg`, shell decision 4).

**The reading measure is capped inside the frame.** The conversation never fills the 70rem width — its
thread caps its text measure at **~42rem** and centres in its column (shell decision 3: "reading-heavy
screens keep a narrower measure"). This is the one place the assistant spends *less* width than the
board on purpose: sustained reading wants a book measure, not a table.

## Layout regions

The assistant renders into the shell's **content-inner** (capped `--bb-content-max` on mobile,
`--bb-content-wide` on desktop, centred). It draws its own title affordance and body; it never draws
chrome. The title lives in three width-gated places so it is shown exactly once:

| Width | Title + threads affordance | Body |
|---|---|---|
| `< md` (mobile) | in-content **header row**: threads icon-Button (`chats-circle`) + `heading` title | single column, cap `--bb-content-max`; composer pinned above the BottomNav |
| `md` (768–1023) | **content-header**: title + a **Conversations** `outline` Button (opens the Sheet) | one **wide** column, cap ~52rem; no rail yet (shell decision 4) |
| `≥ lg` (1024) | rail owns **New conversation**; a compact title heads the conversation column | **grid** `--bb-sidenav 1fr`: **thread rail** + **conversation** |

The mobile shell keeps its **AppHeader** (wordmark + account) and **BottomNav** (Tasks, Assistant —
active); the **Create FAB is hidden on this screen** (components.md — the Composer owns the bottom
region). On desktop the side nav owns brand + account and the Assistant row is the active
destination (`fill` icon, `accent` surface, gold marker).

## ChatBubble — the asymmetric thread

Per `components.md` §Assistant, tuned into the mockup. The conversation is deliberately asymmetric so
the assistant reads as a calm document and the scarce gold is spent on neither turn.

- **User turn** — a filled bubble in the **`secondary`** surface at the inline-end, `radius-lg` with
  a tightened trailing corner, `max-inline-size:85%`, `white-space:pre-wrap`, `dir="auto"` so a
  Hebrew message inside an English thread (or the reverse) keeps its own script.
- **Assistant turn** — **no bubble**: quiet document-like text on the canvas at the inline-start,
  led by a **small assistant mark** (`chat-circle-dots` on a pale `accent` disc, *not* gold). The body
  renders the shipped Markdown subset (paragraphs, ordered/unordered lists, `strong`, inline `code` —
  no links/tables/images, per `markdown.tsx`).
- **Attribution** — where the answer is grounded in knowledge docs, a row of **neutral soft Badge
  chips** (`muted` ground, `file-text` glyph) names those docs beneath the text. A **task-grounded**
  answer (e.g. "who's on the grill today?") carries **no** chips — it draws on the asker's scoped
  board, not a document. *(See "Build implications" — this element is a rebuild target, not shipped.)*
- **Grounded refusal** — when no procedure covers the question, the assistant says so in **ordinary
  quiet text** with a small `info`-led `muted` note. It is a **valid answer, never an error style**
  (principle 4; the anti-fabrication guardrail in `grounding.ts`).

The scarce gold `primary` appears on **neither** bubble — only on the Composer's Send button and the
New-conversation action.

## Composer

Per `components.md` §Composer. Pinned to the bottom of the conversation region (on mobile, in the
BottomNav's region above it): a `card`-ground, `input`-bordered `radius-xl` bar holding a growing
text field (a few lines then scrolls) and a **round `primary` Send** icon-Button at the touch
minimum, its `paper-plane-tilt` glyph **directional** (flips in RTL). States: Send is **disabled while
the field is empty** (rendered as the resting `muted` state in the mockup); while a message is in
flight the whole composer shows its sending state and Send its loading state (single synchronous call,
ADR-0003 — no second question can race it).

## ThreadList — rail and Sheet

Per `components.md` §ThreadList; the same contents rendered two ways (rail at `lg`, Sheet below).

- **New conversation** — the `primary` action at the top (`note-pencil` glyph), resetting to the
  first-run state; the next question lazily creates the thread.
- **Thread row** — an auto-titled row (`chats-circle` glyph + server-derived title, `dir="auto"`,
  truncated) with a timestamp; the **open thread** carries the `accent` surface, a gold inline-start
  marker, and `aria-current`. Threads are private to their author (ADR-0007) — the list never shows
  another user's threads (a data rule, not drawn).
- **Sheet display states** — loading shows **Skeleton** rows; empty shows a short warm line
  ("No conversations yet."); error shows a soft Alert. Rendered in the states frame / Sheet frame.

## Display states

The conversation's own states (`components.md` §Assistant), rendered in the states frame:

- **Pending** — a three-dot indicator on the **assistant side** while the single call runs, removed
  under `prefers-reduced-motion`; `role="status"` labelled "Finding an answer…". The composer is
  disabled meanwhile.
- **Error** — an inline **soft `destructive`-muted** notice with a **Try again** affordance; the
  user's question **stays**, nothing is persisted, retry re-asks it verbatim. Visually distinct from
  the grounded refusal (which is quiet neutral text, not an error).
- **Grounded refusal** — quiet `info`-led `muted` assistant text (a valid answer).
- **Thread list — loading** — Skeleton rows in the rail / Sheet.

The cosmetic typewriter reveal (time-boxed, reduced-motion-safe) and the single polite `aria-live`
announcement of the completed answer are behaviours, not layout — noted for the build, not drawn.

## RTL / LTR

Every region uses **logical properties**, so the RTL-canonical layout is the source and LTR is the
automatic mirror: the side nav and the thread rail sit at the **inline-start**, the user bubble at the
**inline-end** and the assistant text at the **inline-start**, the Sheet is bottom-anchored in both
directions. The only directional glyph on this surface is **Send** (`paper-plane-tilt`,
`icon--directional`); the rest (assistant mark, threads, new-conversation, cite, info) are universal.
Every turn, thread title, and cite is bidi-isolated with `dir="auto"` so authored content keeps its
own script inside chrome of the opposite direction.

## DS component & token mapping

| Region | Composes (`components.md`) | Key tokens / icons |
|---|---|---|
| Title / threads affordance | Button (`outline` Conversations, ghost icon), content-header | `heading-lg`, `input`; `chats-circle` |
| Thread rail / Sheet | ThreadList + Button (`primary` New) + Skeleton | `muted` tray, `radius-lg`, `accent`/`accent-foreground` (active), `primary`; `note-pencil`, `chats-circle` |
| User turn | ChatBubble (user) | `secondary`/`secondary-foreground`, `radius-lg` |
| Assistant turn | ChatBubble (assistant) + attribution | `foreground`, `accent` (mark); `chat-circle-dots`, `file-text` (cite), `info` (refusal) |
| Composer | Composer (Textarea + Button) | `card`, `input`, `radius-xl`, `primary`/`primary-foreground`; `paper-plane-tilt` (directional) |
| First-run | example chips + invitation | `accent` (mark), `outline` chips; `chat-circle-dots` |
| States | Skeleton, Alert (`destructive`-soft), the pending dots | `muted`, `destructive-muted`; `info`, `chat-circle-dots` |

## Icon roles used (registry, `iconography.md`)

`assistant` (chat-circle-dots — nav + assistant mark + example chips), `threads` (chats-circle),
`new thread` (note-pencil), `send` (paper-plane-tilt, **directional**), knowledge-doc chip
(file-text), grounded-refusal note (info), plus the shell's nav/account roles. `fill` weight stays
reserved for the active nav destination (shell); the assistant's resting glyphs are all `regular`.
This screen adds four glyphs to the sprite the shell shipped — **chats-circle**, **note-pencil**,
**file-text**, and **info** — all already in the `iconography.md` §Assistant registry.

## Breakpoint summary

| Width | Threads | Title | Body | Composer |
|---|---|---|---|---|
| `< 768` (mobile) | Sheet (bottom), from header icon | in-content header | 1 col, cap 30rem | pinned above BottomNav |
| `768–1023` (md) | Sheet, from **Conversations** Button | content-header | 1 wide col, cap ~52rem | bottom of column |
| `≥ 1024` (lg) | **persistent rail in-frame** | conversation head | grid: **rail + conversation** (measure ~42rem) | bottom of conversation |

## What this fixes from the #174 audit

- **X1 / X2 / X3** (marooned column, stranded tab-bar, inset unbranded header) — inherited from the
  shell (#175); the assistant composes inside it.
- **Assistant placeholder** — the audit shot the Assistant tab as a placeholder; this mockup gives it
  a real, DS-faithful conversation surface (the feature itself is shipped — threads, grounding, the
  answer path).
- **Desktop width** — spent on a **thread rail + a book-measure conversation**, not a stretched
  full-width thread.

## Build implications (flag, not smuggle)

Two things the downstream `/to-spec` + build must own, called out like the flagship's kanban flag:

1. **Attribution needs a backend `sources` field.** The mockup draws the DS/PRD attribution chips as
   the rebuild **target**, but the shipped answer path deliberately does **not** cite — the system
   prompt (`grounding.ts`, "do not… cite the procedures or their sources") and the `ThreadMessage`
   model carry no sources. Rendering attribution requires adding an `answer.sources` field and
   reversing that prompt line — a product decision taken for this mockup (draw-it-and-flag). If the
   no-cite behaviour is kept, the chips come out and `components.md` §ChatBubble + the `file-text`
   role should be reconciled instead.
2. **DS-vs-shipped ChatBubble divergence.** The shipped UI uses a **gold** user bubble and a bordered
   **card** assistant bubble; this mockup applies the DS's asymmetric treatment (secondary user
   bubble, **no-bubble** assistant document text, gold reserved for Send). The mockup is the rebuild
   target; the rebuild changes the shipped bubbles to match.

## Notes

- This screen starts from the shell's `mockup.html` harness (token CSS, font `@font-face`, Phosphor
  sprite, device-frame + toggle scaffold), so it renders as one system with the shell and board.
- The single-active-thread + lazy-create behaviour, the doubled-opening collapse on thread reopen,
  and the cosmetic typewriter are shipped client behaviours (map #83) — behaviours, not layout, so
  they are described here and not drawn.
