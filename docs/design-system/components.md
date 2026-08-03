# Components

The component layer of the Burgers Bar staff-app design system: every component v1 renders, the
states each carries, and the shadcn/ui primitive each inherits, all expressed against the decided
tokens. This is the third and last document of the design system, and it rests on the other two.

Read principles.md first and tokens.md second. Principles sets the philosophy this inventory
answers to — mobile-first one-thumb ergonomics, Hebrew-first RTL, comfortable density, the warm
plain voice, and the WCAG 2.2 AA bar. Tokens sets the named values every component here draws from;
this document names token roles (primary, muted-foreground, success-muted, radius-lg, space-md,
text-heading-sm, and so on) and never restates their values. Where a component needs a number, it
is the role, not the literal.

The system is a retheme, not a redesign (principle 6). Every component below either is, or inherits
from, a shadcn/ui primitive already in apps/web or added from the same library; structure,
behaviour, and accessibility affordances are preserved and only the styling is repointed at the
tokens. Nothing here is a bespoke widget invented from nothing — the compositions are arrangements
of the primitives.

## How this document is organised

Three layers, general to specific:

- Conventions — the shared state vocabulary and variant rules every component refers back to,
  stated once here rather than repeated per component.
- The primitive kit — the fifteen shadcn/ui primitives v1 adopts, each with its variants, the
  states from the vocabulary that apply to it, and the token roles it paints with.
- Surface compositions — the components built by arranging primitives: the app chrome, the task
  board, and the assistant. The signature compositions (task card, chat bubble) are anatomised in
  full; the already-built auth and people surfaces are referenced against the primitives they use
  and given their retheme deltas rather than re-described.

The scope is v1's three surfaces — the task board, the assistant, and auth and onboarding — plus
the core primitive kit. Iconography, imagery, and motion beyond the reduced-motion rule are out of
scope, the same as in principles.md.

## Conventions

### The state vocabulary

Two families of state. Every component entry below lists which of these apply to it rather than
re-describing them.

Interaction states, for anything a user operates:

- rest — the default, untouched appearance.
- hover — pointer over the element. Present because the app also runs capped on desktop and the
  inherited components ship hover styling, but on touch it is not the primary feedback (see the
  note below).
- pressed — the active, finger-down or mouse-down state. On touch this is the primary feedback that
  a tap registered, so no interactive component omits it; it is a visible change, typically a
  secondary-surface fill and a dropped shadow, not merely a colour nudge.
- focus-visible — keyboard and assistive-technology focus only. Always the ring token (bronze on
  light, gold on dark, both clearing 3:1 from tokens.md), never shown on a plain mouse click. No
  component removes the focus indicator without replacing it with an equally clear one
  (principles.md accessibility bar).
- disabled — not operable. Reduced opacity and pointer-events off; the inherited disabled:opacity-50
  pattern is kept, repointed so the muted surface still reads.
- loading — an in-flight action. The control stays in place, shows a spinner or a busy affordance,
  and is non-interactive while pending, so layout does not jump.

Display states, for anything that renders real data that can be absent, slow, or failed:

- empty — no data yet. A short warm line of copy (principle 4) and, where an action can create the
  first item, one primary call to action.
- loading — data in flight. Skeleton placeholders shaped like the real content, never a bare
  spinner on a blank screen, so the layout is stable when data lands.
- error — the load or write failed. A plain statement of what went wrong and a retry affordance
  (principle 4: errors explain what to do next, without apology).
- selected — the chosen row, item, or nav destination. Carried by the accent surface and its
  foreground, distinct from hover.

### Variant conventions

A variant is a fixed, named appearance of a primitive (a button's primary versus outline); a state
is a transient condition layered on top of whichever variant is showing (that primary button,
pressed). Variants are enumerated per primitive; states come from the vocabulary above. Where a
primitive has a size axis it is named separately from its variant axis.

### How a primitive entry reads

Each primitive below carries: the shadcn/ui source file it is or maps to under
apps/web/src/components/ui, its variants and sizes, the vocabulary states that apply, the token
roles it paints with, and — for the six already in the tree — the retheme delta from its current
hardcoded styling to the tokens. A primitive is implementable verbatim from its entry plus the
reference CSS in tokens.md.

### Direction

Every component is laid out with logical properties (inline-start and inline-end, margin-inline,
padding-inline) so a single definition serves both directions and LTR is the automatic mirror of
the RTL canonical (principle 2). Directional icons — back, chevrons, next and previous, the send
affordance — flip with the direction; non-directional icons do not. User-authored content (task
titles, display names, chat messages) is bidi-isolated so it keeps its own direction inside chrome
of the opposite direction. These rules are set in principles.md and are assumed, not re-decided,
per component; they are called out only where a component does something specific with them.

## The primitive kit

Fifteen primitives. Six are already in apps/web/src/components/ui and are rethemed in place; nine
are added from shadcn/ui as the surfaces that need them are built. Radix Tabs is deliberately not in
the kit: v1 has no in-page tab-panel surface, and the one tab-like need — switching Tasks and
Assistant — is routed navigation, built as the BottomNav composition, not tab semantics. If a
filter-tab need surfaces during the board build, Tabs is added then.

### Button

Source button.tsx (present). The workhorse control, referenced by nearly every composition.

Six variants: primary (the gold fill with dark ink, the single most-important action on a screen —
principle 3, one primary action per screen); secondary (a quiet filled cream-or-ink button for the
non-primary action, for example Cancel beside a primary Save); outline (a bordered transparent
button); ghost (transparent until hover, for icon buttons and low-emphasis actions); destructive
(the solid danger fill, for delete, revoke, and deactivate, with confirmation carried by an
AlertDialog rather than by the button alone); link (an inline text button in the accent-foreground
colour, for example a forgot-password link).

Three sizes: default at the control height (48px, the comfortable-density default from tokens.md);
sm for dense contexts, kept at or above the 44px hit floor; icon, a square button whose visual size
may be smaller than 44px but whose tappable area is padded out to the touch minimum (tokens.md touch
targets).

States: rest, hover, pressed, focus-visible, disabled, loading. Loading shows an inline spinner and
disables the button so a submit cannot be double-fired.

Tokens: primary uses primary and primary-foreground; secondary uses secondary and
secondary-foreground; outline uses border with a transparent ground and foreground text; ghost is
transparent resting and uses accent and accent-foreground on hover and pressed; destructive uses
destructive and destructive-foreground; link uses accent-foreground. Focus is the ring token in all
variants; radius is radius-md.

Retheme delta: today the button ships three variants (primary, outline, destructive) hardcoded to
slate (bg-slate-900, border-slate-300) and red, at h-10 (40px) with a slate focus ring. The retheme
adds secondary, ghost, and link; repoints the fills at the tokens; raises default height from 40px
to the 48px control height (clearing the 44px floor); and swaps the slate ring for the ring token.
The current destructive is a bordered soft-red style — it becomes the solid destructive fill, and
the bordered-red look is available as an outline or ghost button coloured destructive where a
softer destroy affordance is wanted.

### Input

Source input.tsx (present). Single-line text entry. States: rest, focus-visible, disabled, plus an
error condition surfaced by its Field wrapper. Tokens: input for the border, background for the
ground, foreground for typed text, muted-foreground for the placeholder, ring for focus. Height is
the control height; radius-sm; the font is body (16px), which also blocks iOS focus auto-zoom
(tokens.md typography). Retheme delta: slate border and ring to the input and ring tokens, height
raised to the control height.

### Textarea

Source textarea.tsx (add). Multi-line entry for a task description and the assistant composer. Same
variants and states as Input; grows with content up to a few lines then scrolls rather than pushing
the layout. Tokens as Input; min-block-size at the control height. New primitive, styled to the
tokens from the start.

### Select

Source select.tsx (present). A single choice from a short list — role and location on the invite
form, and similar. States: rest, hover, focus-visible, disabled, plus open. The trigger matches
Input's height, border, and radius; the menu is a popover surface using popover and
popover-foreground with elevation-md, the selected option carrying the accent surface. Retheme
delta: slate trigger and menu to the input, popover, and accent tokens.

### Field

Source field.tsx (present). Not a control itself but the label-plus-help-plus-error wrapper around
one, owning the error display state for Input, Textarea, and Select. Tokens: label uses the label
type role and foreground; help text uses caption and muted-foreground; the error message uses
caption and destructive (the solid role reads at message size on the canvas). Retheme delta: slate
and red text to the foreground, muted-foreground, and destructive tokens.

### Card

Source card.tsx (present). The raised content container behind task cards, auth panels, and list
rows. Tokens: card and card-foreground, border for its hairline, radius-lg, elevation resting at 0
(borders-first separation, tokens.md) and rising to elevation-sm only where a card genuinely lifts.
Retheme delta: white and slate to the card, card-foreground, and border tokens.

### Alert

Source alert.tsx (present). An inline, non-dismissable message block — a form-level error, an
info notice. Variants by status: neutral (muted surface and muted-foreground, the info-level look
since there is no info token), success, warning, and destructive, each using its soft status
variant from tokens.md so the message text clears 4.5:1. Radius-lg. Retheme delta: slate and red to
the muted and soft-status tokens; the soft variants replace any solid-fill alert.

### Sheet

Source sheet.tsx (add). A panel that slides in from an edge over a scrim; in this app it is
bottom-anchored by default so its content sits in the thumb zone (principle 1). It carries the
create-and-edit task form, the account menu, and the thread list. Tokens: card or popover surface,
radius-xl on the leading corners, elevation-lg, a scrim over the page. A drag handle sits at the top
edge; the close control is an icon Button padded to the touch minimum. States: the sheet itself is
open or closed; its contents carry their own states. New primitive.

### Dialog

Source dialog.tsx (add). A centred modal over a scrim for a focused task that is not a
destructive confirmation — rare in v1, held for completeness. Tokens: popover surface, radius-lg,
elevation-lg, scrim. New primitive.

### AlertDialog

Source alert-dialog.tsx (add). The confirmation modal for a destructive or irreversible action —
delete a task, revoke an invite, deactivate a user, delete a thread. Two actions: a destructive
confirm Button and a secondary cancel; cancel is the default focus so a stray tap does not destroy.
Tokens: popover surface, the destructive Button for confirm, secondary for cancel, scrim. New
primitive; this is where the destructive Button's confirmation lives.

### DropdownMenu

Source dropdown-menu.tsx (add). A small anchored menu of actions or choices. Two uses in v1: the
task status control (the status pill opens a three-item menu — see StatusControl) and the
resend-and-revoke actions on a pending invite in the people list. Rows are at least the touch
minimum tall; the current or checked row shows a check and the accent surface. Tokens: popover and
popover-foreground, accent for the active row, elevation-md, radius-md. States: rest, hover,
focus-visible per row; open or closed for the menu. New primitive.

### Toast

Source sonner.tsx (add, the Sonner toaster). Brief confirmation and error feedback that does not
interrupt — a task saved, a save failed with a retry. Variants by status using the soft status
variants (success-muted, destructive-muted, warning-muted, and the neutral muted surface) so the
short text clears contrast. Toasts appear in the thumb zone above the bottom nav, carry
elevation-lg, and auto-dismiss with a manual dismiss available; an error toast carries a retry
action. New primitive.

### Badge

Source badge.tsx (add). A small status or category label. Badges always use the soft (tinted)
status variants from tokens.md, never the solid fills, so their small text stays above 4.5:1 in
both themes. Radius-full for a pill, or radius-sm for a squarer chip; label type role.

Badge carries the three enum families of the app, and their mapping to token roles is fixed here:

- Task status. Not started uses the neutral muted surface and muted-foreground. In progress uses the
  accent soft surface and accent-foreground (a warm gold tint that reads as active without spending
  the scarce gold primary fill). Done uses the success soft variant (the earthy olive). Status is
  the gold-and-neutral family.
- Priority. Low uses the neutral muted surface. Normal renders no badge at all — it is the implicit
  default, and omitting it cuts noise on the board. High uses the warning soft variant (the burnt
  orange). Priority is the orange family, so a status badge and a priority badge never read as the
  same signal on one card.
- User status, in the people list. Invited-and-pending uses the warning soft variant (an action is
  awaited). Active uses the success soft variant. Deactivated uses the neutral muted surface.

States: badges are largely static; the task-status badge is the one exception, because it is also
the interactive StatusControl and so additionally carries the interaction states of its
DropdownMenu trigger. New primitive.

### Avatar

Source avatar.tsx (add). A person's initials in a circle — assignees on a task card, the account
avatar in the header, the participants in a thread are implicit. Falls back to initials on a soft
accent ground (there are no uploaded photos in v1). Radius-full; the accent surface and
accent-foreground; a stack of avatars overlaps with a small card-coloured border between them. New
primitive.

### Skeleton

Source skeleton.tsx (add). The loading-state placeholder — grey blocks shaped like the content they
stand in for, used by the task board and the thread list. A muted surface with a gentle shimmer that
is removed under prefers-reduced-motion (principle 5). Radius matching the content it replaces. New
primitive.

## Surface compositions

The components built by arranging primitives. Grouped by surface: the global chrome first, then the
task board, then the assistant, then the built auth and people surfaces.

### Global chrome

The frame every screen sits inside.

Build status. The shell was built before this design system was wired — the navigational shell
merged at issue #80, giving apps/web a real AppHeader, BottomNav, and account menu on the unbranded
slate styling. It is therefore a built-and-rethemed surface, the same as auth and people below, and
the design-system wiring feature (issue #101) retheme it in place onto the tokens. Where the built
shell diverges from the composition described here — most notably the account menu, which #80 built
as a header dropdown popover carrying the signed-in role, the language toggle, Manage users, and the
logout actions, rather than the bottom Sheet with a fuller profile list described under AvatarMenu —
the built structure stands and only its styling is rethemed (principle 6); moving it to a Sheet is a
later composition change, not part of the retheme. The descriptions below remain the target design
for the chrome; the retheme does not redraw them.

AppHeader. A compact, sticky bar on the card surface at the top of every top-level screen: the
screen title at the inline-start in the heading-md role, the account Avatar at the inline-end. No
back button on a top-level screen; the header is for reading, not primary action (principle 1), so
no primary control lives here. Tokens: card ground, border underline, foreground title.

BottomNav. A persistent navigation bar pinned to the bottom, built as a router composition (not
Radix Tabs), with role navigation. Two destinations, Tasks and Assistant, each a router link with
an icon above a label. The active destination carries the selected display state — the
accent-foreground label and a gold primary dot under its icon; the inactive one is
muted-foreground. Pinned with elevation-sm, its padding respecting the bottom safe-area inset so it
clears the home indicator. Directional neutrality: the two items keep their order but the bar
mirrors with direction like everything else.

Create FAB. A round primary Button floating in the bottom-inline-end thumb zone, above the
BottomNav, opening the TaskFormSheet to create a task. It is shown only to managers and admins (an
employee cannot create tasks — PRD permissions) and is hidden on the Assistant screen, where the
Composer owns that region. Tokens: primary and primary-foreground, radius-full, elevation-md.

AvatarMenu. Opened by tapping the header Avatar, rendered as a bottom Sheet rather than a top
dropdown so its items sit in the thumb zone — the header avatar is at the top-inline-end corner, out
of one-thumb reach, and a top-anchored menu would put every choice there too. The sheet carries a
short profile header (avatar, display name, role and location), then Profile, a Language toggle and
a light-or-dark Theme toggle shown inline as small segmented controls, Settings, and Log out (a
destructive-coloured row). The theme toggle stamps the dark class on the document root the way the
locale provider stamps direction (tokens.md). Built on Sheet; the toggles are the LanguageToggle
pattern (see below).

The theme toggle and the dark-mode machinery it drives are built by the wiring feature (issue #101),
which adds a ThemeProvider that stamps the dark class and persists the choice, and places the
light-or-dark segmented toggle in the built account menu beside the language toggle. Until #101 the
app had no theme machinery at all; the dark token values existed in the spec but were unreachable.

### Task board

TaskCard. The signature composition of the board, the thing staff scan most. Title-led and title-only
— the card shows no description preview; the full description lives in the edit sheet — which keeps
cards short and the board calm at comfortable density (principle 3), betting on descriptive titles.

Anatomy, top to bottom:

- Title, in the heading-sm role at weight 600, wrapping to at most two lines. The card's anchor.
- A high-priority Badge trailing the title, shown only when priority is high (warning soft); low and
  normal show nothing.
- A meta row: the StatusControl pill at the inline-start; then the due date in the caption role and
  muted-foreground, which flips to the destructive-soft foreground at weight 600 when the task is
  overdue; then, pushed to the inline-end, the assignee Avatar stack. A completed task shows its
  completed time in place of the due date.

States: rest; pressed (a secondary-surface fill with the shadow dropped — the primary touch
feedback); done, where the whole card dims to roughly 60 percent opacity and shows the success
status and completed time, with no strikethrough (which reads as harsh — principle 4). For a
manager or admin a task with no assignees is a backlog card: the Avatar stack is replaced by a
Backlog-and-unassigned chip, and backlog is visible only to managers and admins (PRD). Role shapes
interaction: an employee can operate only the StatusControl; a manager or admin taps the card body
to open the TaskFormSheet for full edit.

StatusControl. How a task's status changes, and the employee's single write action. The status
Badge on the card is itself the control — a button that opens a DropdownMenu of the three statuses
(not started, in progress, done), the current one checked, each row at the touch minimum. One tap to
open, reversible, accessible, and compact enough for a narrow card, where a three-segment inline
control would not fit at 44px targets in two languages. A manager or admin can also change status
inside the TaskFormSheet, which carries the same three-way choice.

TaskBoard. The container the cards sit in: a single-column, vertically scrolling list of TaskCards,
edge margins at space-md and row gaps between space-sm and space-md (tokens.md comfortable-density
defaults). Its display states are the design-system's concern: loading shows Skeleton rows shaped
like task cards; empty shows a short warm line and, for a manager or admin, a primary create call to
action; error shows a plain message with a retry. How the populated list is grouped, ordered, or
filtered — by status, by priority, by drag-to-reorder — is board-feature behaviour and is decided
by the board build feature, not here; this document specifies the card and the container and their
states only.

TaskFormSheet. The create-and-edit form, a bottom Sheet (managers and admins only). It arranges
Field-wrapped primitives: the title as Input, the description as Textarea, priority and — for an
admin editing across locations — location as Select, status as a three-way choice, an assignee
picker, and a due date. A primary Save and a secondary Cancel sit in the thumb zone; deleting a task
from here routes through an AlertDialog. The assignee picker's exact interaction (it is a multi-select
constrained to the task's own location) is board-feature detail; this document places it in the sheet
and leaves its mechanism to the build.

### Assistant

ChatBubble. The assistant conversation is asymmetric. The assistant's turns render as calm,
document-like text directly on the canvas at the inline-start, led by a small assistant mark, with no
bubble — which suits a helper that is reading procedures to the user and keeps the thread quiet. The
user's turns render as a filled bubble in the secondary surface at the inline-end. The scarce gold
primary is spent on neither bubble — only on the Composer's send button. Each turn is bidi-isolated so
a Hebrew message inside an English thread, or the reverse, keeps its own direction; alignment is
logical, so the whole thread mirrors with direction automatically.

Attribution and states:

- Attribution. Where the assistant grounds an answer in knowledge docs, it shows a row of neutral
  soft Badge chips naming those docs beneath its text (PRD: the assistant attributes what it draws
  on).
- The grounded refusal. When there is no procedure for something, the assistant says so in ordinary
  assistant text with a quiet neutral note, never an error style — it is a valid answer, not a
  failure (PRD: it does not invent).
- Assistant message states: pending, a three-dot indicator on the assistant side while the single
  AI call runs (ADR-0003), removed under prefers-reduced-motion; complete; and error, an inline
  message with a retry when the AI call itself fails — visually distinct from the valid refusal.
- User message states: sending, sent, and failed — a failed send dims the user bubble and shows an
  inline retry in the ring colour, distinct from an assistant error.

Composer. The message entry pinned to the bottom of the Assistant screen, in the BottomNav's region
above it: a Textarea that grows to a few lines then scrolls, and a round primary send Button (an
icon button at the touch minimum, its send glyph directional so it flips in RTL). States: the send
button is disabled while the field is empty; while a message is in flight the composer shows the
sending state and the send button its loading state. Tokens: card ground, input-bordered field,
primary send.

ThreadList. A user's private conversations, opened as a Sheet. A scrolling list of the user's
threads, each an auto-titled row with the thread title and a timestamp, the currently open thread
carrying the selected accent surface. A new-thread primary action sits at the top; deleting a thread
routes through an AlertDialog (a user can delete their own threads — PRD). Display states: loading
shows Skeleton rows; empty shows a short warm line inviting the first question. Threads are private
to their author, which is a data-access rule (ADR-0003, ADR-0007), not a component concern, but the
list never shows another user's threads.

### Auth and onboarding, and people

These surfaces are already built in apps/web (the auth screens and the people-management screens).
They are referenced against the primitives they use and given their retheme deltas rather than
re-anatomised, since their structure already exists and only the styling changes.

The auth screens — login (routes/login.tsx), accept-invite (routes/accept.tsx), and the two
password-reset screens (routes/reset-request.tsx, routes/reset-consume.tsx) — each supply a form of
Field-wrapped Inputs with a primary submit, rendered inside the shared AuthLayout. The frame is the
one design-system surface that is redesigned rather than rethemed — a sanctioned exception to
principle 6, recorded in ADR-0018 — so it is anatomised here in full, unlike the retheme-only
surfaces around it. Its composed pieces:

- AuthLayout (components/auth-layout.tsx) — the pre-auth frame. On desktop it is a 50/50 split: a
  brand panel on the inline-start, the form on the inline-end, divided down the middle. The split is
  built from logical properties alone, so Hebrew/RTL is the canonical layout and LTR its automatic
  mirror (principle 2); it unfolds only at the desktop breakpoint. On a phone the split does not
  appear — the panel collapses to a short brand cap above the form, and the primary submit stays in
  the lower thumb arc (principle 1).

  The brand panel is the signature. Its field is primary (gold is primary), constant in both light
  and dark, carrying a subtle gradient and a soft warmth glow toward the inline-start-top. On it,
  the "bracket embrace" treatment: the mark's two brackets enlarged tone-on-tone to frame the centred
  wordmark, with a hairline rule and the tagline beneath. The panel is composed entirely from the
  existing brand geometry — the mark, the isolated brackets glyph, and the wordmark lockup from the
  #107 asset set — per ADR-0016 (compose, don't redraw); it introduces no new illustration. The
  bracket decoration is aria-hidden and mirrors as a glyph in RTL while the Latin wordmark keeps its
  orientation. All panel ink is primary-foreground on primary, clearing the contrast bar (8.7:1) in
  both themes.

  The tagline carries the warm-plain-respectful voice (principle 4), written natively per language:
  "המשמרת מתחילה כאן." / "Your shift starts here."

  The form side is a crisp canvas, not a Card: the form sits directly on background (white in light,
  deep ink in dark) rather than in a raised card panel, with the type sharpened and inputs carrying a
  focus-halo built from the ring token. This is the one place the built auth form leaves its
  inherited Card behind; the Fields, PasswordField, LanguageToggle, and submit inside it are
  otherwise unchanged retheme primitives.

  Motion — the panel's rise-in and the glow — is non-essential and is reduced or removed under
  prefers-reduced-motion (principle 5). Both themes are specified. The redesign is a plan of record
  (ADR-0018; mockup at docs/prototypes/pre-auth-frame.html); a separate /implement builds it against
  auth-layout.tsx and the four routes.
- LanguageToggle (components/language-toggle.tsx) — the Hebrew-and-English segmented control carried
  by every pre-auth screen and reused in the AvatarMenu. It is a fieldset of two aria-pressed
  buttons; the selected one is filled. Retheme: the selected fill from slate to primary or accent,
  the unselected from slate text to foreground and muted, the border to input. It is a small
  composition, not a shadcn primitive.
- PasswordField (components/password-field.tsx) — an Input with a show-and-hide toggle, used on
  login, accept, and reset-consume. Retheme: inherits Input's delta; the toggle is a ghost icon
  Button padded to the touch minimum.

The people-management surface (features/people) — the invite form (invite-form.tsx), the user list
(user-list.tsx), and their container (people-management.tsx) — composes Inputs and Selects for
inviting (name, role, location, constrained by the inviter's own permissions), and a list of users
each showing a user-status Badge (invited, active, deactivated, per the Badge mapping above) with
resend-and-revoke actions on a pending invite through a DropdownMenu and deactivation confirmed
through an AlertDialog. Retheme: slate and red throughout to the tokens; user-status colours to the
soft status variants; control heights raised to the control height.

The common retheme delta across all built surfaces — the auth and people screens and the shell
(see the Global chrome build-status note): hardcoded slate and red utilities (bg-slate-900,
text-slate-600, border-slate-300, text-red-700) repoint at the semantic tokens; the h-10 (40px)
control height rises to the 48px control height, clearing the 44px touch floor; and the slate focus
ring becomes the ring token. This is styling only — no structure, behaviour, or accessibility
affordance of the built screens changes. The wiring feature (issue #101) applies this delta, plus
the shell's BottomNav active state moving to the accent-foreground label and gold primary dot.

The one exception to "styling only" is the pre-auth frame anatomised above: its split, brand panel,
and no-card form are a redesign (ADR-0018), not part of this retheme delta, and land in their own
/implement rather than through #101.

## Accessibility conformance

The component layer holds the line set in principles.md and met by the tokens. Every interactive
component has a visible focus-visible state in the ring token and never removes it; every hit area
is at least the touch minimum even where the visual control is smaller (icon buttons, the sheet
close, checkboxes); pressed state gives touch users confirmation a tap registered; disabled controls
are non-interactive and still legible; skeletons and the pending indicator respect
prefers-reduced-motion. All colour pairings are inherited from tokens.md, which certifies them
against the 4.5:1 and 3:1 bars — this layer adds no new pairing, and badges, toasts, and status
messages use the soft variants precisely so their small text stays above the text ratio. Errors and
empty states are written in the warm, plain, next-step voice of principle 4.

## Scope and hand-off

This document decides the component inventory, its states, and the shadcn/ui mapping only. It does
not wire anything into apps/web: adding the nine new primitives, rethemeing the six present ones and
the built screens, and building the unbuilt compositions are the hand-off — a later build feature
executes this spec against the reference CSS in tokens.md, the same way tokens.md stopped at
reference CSS and principles.md at principles. Iconography, imagery and illustration (the empty-state
art, the assistant mark, the nav icons named here only by role), and motion beyond the reduced-motion
rule are out of scope and surface once the visual foundations are set. Grouping, ordering, and
filtering on the task board, and the assignee-picker mechanism, are board-feature decisions noted
here and left to that feature.

With this document, the design system is complete: principles, tokens, and components — an approved
specification ready to hand to the build.
