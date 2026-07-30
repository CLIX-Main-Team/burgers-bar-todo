# Invite-only provisioning with a seeded first admin, email/password auth, and invite-encoded role/location

The charter fixed "deliberately minimal" auth — simple login, then straight to the todo —
and ADR-0001 put user provisioning inside the app (admins invite anyone; managers invite
employees to their own location). The ticket #7 grilling turned that into a concrete flow.

Decisions:

- **Invite-only, no self-signup.** There is no public registration route. Every user enters
  through an invite. The very first admin is seeded out-of-band at deploy time (a one-off
  insert), which resolves the chicken-and-egg of who invites the first inviter without
  standing up a guarded public signup path.

- **Email + password (Supabase Auth).** Login is plain email+password. The invite is a
  one-time, single-use link that lands the recipient on a set-password screen; thereafter
  they log in normally. Chosen over magic-link (every login would depend on an email
  round-trip — painful on shared floor devices) and Google OAuth (would exclude employees
  without a Google account). A forgot-password reset email is in v1 because email+password
  requires it. Sessions are persistent until explicit logout.

- **Invite-encoded, immutable role and location.** The inviter chooses role and location when
  creating the invite; both are baked in and cannot be altered by the recipient. Manager
  invites are hard-constrained to `{employee, the manager's own location}`; admin invites are
  unconstrained. This keeps role-elevation and location assignment on the provisioning side,
  never the user's — the same trust posture as ADR-0001.

- **Pending user record at invite time.** Creating an invite immediately creates the user
  record with role and location set and `status = invited`, so outstanding invites are
  visible in the inviter's user list and can be resent or revoked. The token is single-use
  and expires (~7 days) so a leaked link encoding a role does not stay valid forever. On
  accept the status flips to `active`.

- **Soft deactivation.** Deactivating a user revokes their session and blocks login but
  retains the record (`status = deactivated`), so historical `created_by` and assignee
  references still resolve to a real name, and the user can be reactivated. Deactivation does
  not auto-reassign the user's open tasks; a manager reassigns as needed. Hard delete was
  rejected because it orphans task history on an audit-bearing board.

The accept screen and the display name: the inviter supplies the display name (they know
their staff), so the accept screen is just "set your password" plus a Hebrew/English toggle
whose choice is saved as the user's `preferred_language`.

## Consequences

- The user model carries at minimum: `id, email, display_name, role, location_id` (null for
  admin), `status (invited|active|deactivated)`, `preferred_language (he|en)`, timestamps,
  plus invite fields (`token`, `expires_at`, `invited_by`) inline or in a small `invites`
  table.
- Do not add a public signup route later without revisiting this ADR — invite-only is a
  deliberate trust boundary, not an omission. If open signup is ever needed, it is a new
  decision with its own role-assignment story.
- The login, accept, and password-reset screens are pre-auth surfaces that must still honour
  the bilingual RTL/LTR toggle, since the user's `preferred_language` may not exist yet.
