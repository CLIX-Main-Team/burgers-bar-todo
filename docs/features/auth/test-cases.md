# Auth — test cases

The test cases for the authentication feature, derived from the acceptance criteria in the
user stories of GitHub issue #25 and from that issue's testing decisions. This is the third
rule-4 planning artifact, alongside ui-flow.md and plan.md; it rests on ADR-0005, ADR-0006,
ADR-0007, ADR-0008, ADR-0009, and ADR-0010. It enumerates what must be proven; the how of the
harness is in plan.md and issue #25.

Each case names the behaviour, the way it is asserted, and the user story or stories it traces
to (story numbers refer to issue #25). Cases are grouped by area and carry a stable id
(TC-AREA-nn) so the pull request and any later regression can cite them.

## How these are exercised

One seam, external behaviour only (issue #25). Every case drives the Fastify HTTP boundary
in-process via app.inject(), and asserts on HTTP status and body, on state observed through a
follow-up API call, and on captured outbound mail — never by reading database rows, inspecting a
password hash or a token at rest, or calling an internal helper. A password set is proven by a
later sign-in succeeding; a revocation is proven by a later request being refused; a sent mail is
proven by the capturing fake mailer and by driving the issued one-time link back through the API.

Three dependencies are substituted by injection: a real ephemeral Postgres (Testcontainers,
migrated fresh, so real SQL, constraints, and enums run — not a mock or SQLite), the capturing
fake mailer port, and an injectable clock (or direct control of expires_at) so every expiry case
is deterministic. The test environment may lower argon2id cost for speed — a timing change, not a
behaviour change. SPA UI testing is out of scope for this feature (issue #25); these cases are
API-behaviour cases.

Thoroughness. The security negatives below are covered as exhaustively as the happy paths, per
issue #25. A case that asserts a generic, non-revealing response is as important as the one that
asserts success.

## Seed admin

TC-SEED-01 — Seed creates the first admin. After the env-driven seed runs, signing in with the
seed credentials succeeds and the current-principal read reports role admin, location null,
status active. Stories 1, 2.

TC-SEED-02 — Seed is idempotent. Running the seed a second time with the same credentials leaves
exactly one admin and does not overwrite it: sign-in still succeeds and no duplicate admin is
observable through the API. Story 2.

TC-SEED-03 — Seeded password uses the real hash path. The seeded admin can sign in, proving the
seed hashed through the same argon2id path sign-in verifies against (asserted behaviourally, not
by reading the hash). Stories 1, 2.

## Invite creation and provisioning constraints

TC-INV-01 — Admin invites any role to any Location. An admin creates employee, manager, and
admin invites across different Locations; each succeeds and the invited user appears via the API
with status invited and the baked role and Location. Stories 3, 8.

TC-INV-02 — Manager invites an Employee to their own Location. A manager creates an employee
invite for their own Location; it succeeds and the pending user appears with status invited.
Story 4.

TC-INV-03 — Manager cannot invite a Manager. A manager's attempt to create a manager invite is
refused and no user is created. Story 5.

TC-INV-04 — Manager cannot invite an Admin. A manager's attempt to create an admin invite is
refused and no user is created. Story 5.

TC-INV-05 — Manager cannot invite to another Location. A manager's attempt to create an employee
invite for a Location other than their own is refused and no user is created. Story 5.

TC-INV-06 — Client-supplied role and Location are ignored. When the request carries a role or
Location that differs from what the acting principal is allowed, the baked server-side values win
(or the request is refused); the recipient can never influence role or Location. Stories 5, 7.

TC-INV-07 — Inviter sets the display name. The display name supplied at create time is the one
observed on the pending user through the API. Story 6.

TC-INV-08 — Invite sends a one-time-link email. Creating an invite captures exactly one outbound
mail to the invitee carrying a usable one-time link. Story 12.

TC-INV-09 — Pending user is visible immediately. Right after create, the invited user is present
in the inviter's user list with status invited, before any acceptance. Story 8.

## Invite lifecycle: accept, resend, revoke, expiry

TC-ACC-01 — Accept sets password, activates, and signs in. Accepting with a valid token and a
valid password returns a session; the user's status is now active (a subsequent sign-in with the
new password succeeds) and the session authenticates a current-principal read. Stories 13, 15.

TC-ACC-02 — Accept saves the chosen language. The preferred_language chosen at accept is
observable on the user afterwards through the API. Story 14.

TC-ACC-03 — Accept rejects a too-short or empty password. Accepting with an empty or
below-minimum password is refused; the user stays invited (a sign-in still fails) and the token
is not consumed. Story 36.

TC-ACC-04 — Expired invite token is rejected. An invite token past its ~1-week expiry fails at
accept with a clear error and does not activate the user. Story 11.

TC-ACC-05 — Used invite token is rejected. A token already consumed by a successful accept fails
on a second accept. Story 16.

TC-ACC-06 — Invalid or non-existent token is rejected. Accepting with a mismatched or unknown
token fails and creates no session. Story 16.

TC-ACC-07 — Resend issues a fresh token and invalidates the prior one. After resend, the newly
mailed link accepts successfully and the previously mailed link is rejected. Story 9.

TC-ACC-08 — Revoke invalidates the token and removes the pending user. After revoke, the invite
link is rejected and the pending user is no longer present via the API. Story 10.

## Sign-in

TC-LOGIN-01 — Correct credentials succeed. An active user signing in with the right email and
password receives a session that authenticates a current-principal read. Story 17.

TC-LOGIN-02 — Wrong password gives the generic failure. Signing in with a valid email and a
wrong password fails with the single generic message and no session. Story 18.

TC-LOGIN-03 — Unknown email gives the identical generic failure. Signing in with an unregistered
email fails with the same status and body as TC-LOGIN-02, so the two are indistinguishable.
Story 18.

TC-LOGIN-04 — Invited user cannot sign in. A user who has not accepted (status invited) is
refused sign-in with the generic failure. Story 19.

TC-LOGIN-05 — Deactivated user cannot sign in. A deactivated user is refused sign-in with the
generic failure. Story 19.

TC-LOGIN-06 — Email matches case-insensitively. Signing in with the email in a different case
than it was invited with succeeds. Story 20.

## Session lifecycle

TC-SESS-01 — Valid bearer authenticates. A request carrying a valid session token resolves to the
correct principal. Stories 17, 21.

TC-SESS-02 — Missing token is unauthorized. A request with no Authorization header is refused.
Story 21.

TC-SESS-03 — Malformed token is unauthorized. A request with a malformed or garbage bearer value
is refused. Story 21.

TC-SESS-04 — Revoked token is unauthorized. After logout, the previously valid token is refused
on its next use. Story 24.

TC-SESS-05 — The idle window slides on use. With the injected clock advanced within the window
and the session used, the session remains valid past the original issue-plus-window instant,
proving the window extends on each authenticated request. Story 22.

TC-SESS-06 — Idle beyond the window expires. With the clock advanced past the full idle window
with no use, the next request is refused. Story 22.

TC-SESS-07 — Persistence across a restart. A token issued earlier still authenticates on a later,
independent request with no re-sign-in, standing in for closing and reopening the app. Story 23.

TC-SESS-08 — Logout revokes only the current session. With a user holding two sessions, logout on
one refuses that token's next request while the other session still authenticates. Story 24.

TC-SESS-09 — Logout-all revokes every session. With a user holding two sessions, logout-all
refuses both tokens' next requests. Story 25.

## Password reset

TC-RESET-01 — Active user's request sends mail. A reset request for an active user captures one
outbound mail with a usable one-time link and returns the generic confirmation. Story 26.

TC-RESET-02 — Unknown email returns the generic response and sends nothing. A request for an
unregistered email returns the same status and body as TC-RESET-01 and captures no mail. Story
27.

TC-RESET-03 — Invited email returns the generic response and sends nothing. A request for a
user who is still invited returns the identical generic response and captures no mail. Stories
27, 33.

TC-RESET-04 — Deactivated email returns the generic response and has no effect. A request for a
deactivated user returns the identical generic response, captures no mail, and produces no usable
reset token. Stories 27, 33.

TC-RESET-05 — Consume sets a new password. Consuming a valid reset token with a valid new
password succeeds and a subsequent sign-in with the new password succeeds. Story 26.

TC-RESET-06 — Consume rejects a too-short or empty password. Consuming with an empty or
below-minimum password is refused and the token is not consumed. Story 36.

TC-RESET-07 — Reset token is single-use. A reset token already consumed is rejected on a second
consume. Story 28.

TC-RESET-08 — Reset token expires quickly. A reset token past its ~1-hour expiry is rejected at
consume. Story 28.

TC-RESET-09 — Invalid or non-existent reset token is rejected. Consuming with an unknown or
mismatched token fails. Story 28.

TC-RESET-10 — Consuming a reset revokes all sessions. With the user holding active sessions,
completing a reset refuses every one of those sessions' next requests. Story 29.

TC-RESET-11 — A new reset invalidates outstanding reset tokens. Requesting a second reset before
consuming the first makes the first token unusable at consume. Story 28.

TC-RESET-12 — Per-email rate limit trips. Repeated reset requests for the same email beyond the
limit are throttled while still returning the generic confirmation, so throttling leaks no
signal. Story 30.

TC-RESET-13 — Per-IP rate limit trips. Repeated reset requests from the same IP across differing
emails beyond the limit are throttled, still returning the generic confirmation. Story 30.

## Deactivation, reactivation, and principal freshness

TC-DEACT-01 — Deactivation blocks sign-in immediately. After an admin deactivates a user, that
user's sign-in is refused with the generic failure. Story 31.

TC-DEACT-02 — Deactivation revokes an in-flight session. A user's previously valid session is
refused on its next request once the user is deactivated. Story 31.

TC-DEACT-03 — The record is retained. After deactivation the user is still observable via the API
with status deactivated (not gone), so historical references still resolve. Story 31.

TC-DEACT-04 — Reactivation restores sign-in. After an admin reactivates a deactivated user, that
user can sign in again with their existing password, without re-provisioning. Story 32.

TC-FRESH-01 — Role change takes effect on the next request. After a role reassignment, the user's
next request reflects the new role in the principal, with no re-sign-in. Story 34.

TC-FRESH-02 — Location change takes effect on the next request. After a Location reassignment, the
user's next request reflects the new Location in the principal, with no re-sign-in. Story 34.

## Coverage and traceability

Every one of issue #25's 36 user stories is exercised by at least one case above; the
security-critical negatives (non-enumeration on sign-in and reset, invite provisioning
constraints, token single-use and expiry, all-session revocation on reset and deactivation,
principal freshness, and the reset rate limits) are covered as fully as the happy paths, per that
issue's testing decisions.

Traceability chain: issue #25 (spec / PRD input) → ui-flow.md and plan.md → this Test Cases
document → the pull request implementing the feature under rule-5 human review. The suite these
cases define is the first API integration suite in the repository and establishes the pattern
(Vitest plus Fastify inject, Testcontainers-Postgres, the fake mailer port, the injectable clock)
the later task-board and Assistant features reuse.
