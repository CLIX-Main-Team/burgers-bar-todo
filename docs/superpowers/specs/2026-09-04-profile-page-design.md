# Profile page

A signed-in person edits their own display name, chooses the colour of their avatar disc, and
changes their password. Owner ask, 2026-09-04.

## Why this and not a photo

The owner's opening idea was an uploaded photo or, failing that, a colour. The app has no upload
path at all: no storage bucket, no multipart parsing, no image library, and the single API client
seam only sends JSON. A photo is therefore a project of its own, and it is deferred. A colour is a
smallint on the row the app already has, and it reaches every avatar through fields the API already
emits. That is the whole feature: small, and shipped first.

The avatar colour today is a hash of the display name (avatar-color.ts), chosen precisely so that
nothing had to be stored. A stored choice is added on top of that rule, not instead of it. Null
means "automatic", which is the hash, so every existing person keeps the disc they have until they
choose otherwise, and renaming a person who has chosen no longer moves their colour.

## Where it lives

There is no Settings page. Access and Users are two rows in the gear-icon account popover
(account-menu.tsx), each opening its own top-level route. Profile follows the same shape: a third
row, above Users, visible to every signed-in person, opening `/profile`. No capability gates it, on
the client or the server, because it edits only the caller's own row; plain authentication is the
gate.

The popover's identity block today draws a generic account glyph because "the principal carries no
photo". It now draws the person's own avatar disc, initials on their chosen colour, so a saved
colour is visible the moment the popover reopens. The phone "More" tab keeps its overflow glyph;
the disc appears inside the sheet it opens.

## Data

Migration 0040 adds `users.avatar_tone smallint null` with a check constraint `between 1 and 8`.
The knowledge-drive-mirror branch also authored a 0040, from the same "previous + one day" rule,
and applied it to the shared local database — which is why this migration was skipped in silence
there while reporting success. That branch has not merged; `main` and production are both at 0039,
so 0040 is this branch's, and whichever of the two lands second renumbers.
The journal entry takes the next hand-authored stamp in the established pattern (last + 86400000).
The eight values are the eight person tones already defined in index.css; the number is the index
the class pair `bg-person-N text-person-N-ink` wears. Nothing else about the palette changes.

## Shared contracts

`avatarTone: z.number().int().min(1).max(8).nullable()` is added to every shape that names a
person:

- `principalResponseSchema`, which also gains `email`, so the page can show it read-only.
- `userSummarySchema`.
- `taskUserRefSchema`, and through it assignees, creators, and project step owners.

One field on every reference rather than a directory lookup, for two reasons. The avatar call sites
pass a name today and would all have to learn an id for a lookup to key on. And `GET /users` is
gated on `page.users`, so an employee's task board could not fetch a directory at all; the board
must carry the colour itself.

Two new request shapes:

- `updateProfileRequestSchema`: `{ displayName?: string, avatarTone?: 1..8 | null }`. Absent means
  leave alone; explicit null clears the colour back to automatic. displayName is trimmed, required
  non-empty, and capped at the same length the invite form allows.
- `changePasswordRequestSchema`: `{ currentPassword: string, newPassword: passwordSchema }`.

## API

- `GET /auth/me` answers the widened principal. The principal built at session validation carries
  `email` and `avatarTone` from the users row.
- `PATCH /auth/me` applies `updateProfileRequestSchema` to the caller's own row and answers the
  fresh principal. It touches nobody else's row and reads no id from the body.
- `POST /auth/change-password` verifies `currentPassword` against the stored argon2 hash. A wrong
  one answers 403 with a distinct error code so the form can point at the right field. On success
  the new hash is stored, every other session of this user is ended, and the calling session is
  kept, reusing the logout-all plumbing.

The three repositories that select `users.display_name` into a person reference (auth, projects,
task board) select `avatar_tone` beside it.

## Web

- `Avatar` gains `tone?: number | null`. A helper resolves the class pair: the stored tone when
  present, the name hash when null. `AvatarStack` takes `{ name, tone }` pairs instead of bare
  names. Every call site passes the tone it already receives from the API.
- A `/profile` route under the authenticated layout renders `features/profile/profile-screen.tsx`.
- The page draws its own header in the Access idiom, then three cards:
  1. Identity: a large live avatar preview, the display name field, and email, role, branch as
     read-only rows. Name and colour share one Save.
  2. Colour: the eight swatches plus "Automatic", as a radio group. Selecting one updates the
     preview immediately; nothing is stored until Save.
  3. Password: current, new, confirm, using the existing password field. Its own Save.
- Saving invalidates the `['auth','me']` query so the popover and every avatar update, and the
  users query so the People roster follows.
- Strings live under a `profile` namespace in both locale trees of messages.ts. Layout uses logical
  properties only, per the existing RTL rule.
- The visual direction is decided at implementation time with the frontend-design and
  ui-ux-pro-max skills: structure and accessibility guidance from them, palette from the app's own
  token layer.

## Testing

- API: PATCH me updates name and tone, rejects tone 0 and 9, rejects an empty name; change-password
  rejects a wrong current password with the distinct code, accepts a correct one, and ends the other
  session.
- Web: avatar unit test for the tone override and the null fallback; one Playwright spec that saves
  a colour and sees the disc change in the popover.

## Out of scope

Photo upload. Email change. Preferred language on the page. Phone number. An admin editing
somebody else's colour.
