# Auth — UI flow

The user-facing surfaces of the authentication feature: the four pre-auth screens and the
in-app session and provisioning touchpoints. This is a rule-4 planning artifact for the auth
feature; its spec (PRD input) is GitHub issue #25, and it rests on ADR-0005, ADR-0006,
ADR-0007, ADR-0008, ADR-0009, and ADR-0010. Written text-first per rule 11: this prose is the authority
on the flow. No drawn diagram is kept for it now; if one is later wanted it is a separate
Excalidraw file rendered from this text, and this text stays the authority.

Traceability. Every screen and touchpoint below cites the user stories from issue #25 it
serves. The reverse — a Test Cases document derived from those same stories — is the next
artifact after this one and the plan.

Scope of this document. It describes what the user sees and does and how state moves, not the
visual design system, component library, or pixel layout — those inherit Clix-CRM's React 19 /
Tailwind v4 / shadcn/ui surface (engineering-design.md) and are settled at build time. Full
user-management screens beyond what invite and sign-in require are out of scope (issue #25);
the invite and deactivation surfaces below are described only to the depth this feature
delivers. Automated testing of these SPA screens is explicitly out of scope for this feature
(issue #25); the screens are still specified here because the flow is user-facing and rule 4
requires it.

## Cross-cutting behaviour

These hold across the screens below rather than belonging to any one of them.

Bilingual, direction-aware pre-auth. The login, accept, reset-request, and reset-consume
screens all honour the Hebrew/English toggle and switch document direction with it — Hebrew
renders right-to-left, English left-to-right. This is load-bearing here because a person on the
accept screen has no saved preferred_language yet (an ADR-0005 consequence): the pre-auth
surface cannot read a preference that does not exist, so it carries its own toggle. Stories 14,
35.

Session credential and persistence. On any success that signs a user in — accepting an invite,
signing in, and only those — the API returns an opaque bearer session token. The SPA stores it
in persistent client-side storage and sends it as an Authorization: Bearer header on every
subsequent API call (ADR-0006). Because storage is persistent and the session is a sliding
idle window (about two weeks, SESSION_TTL_DAYS=14, extended on each authenticated request),
closing and reopening the app keeps the user signed in; only genuine disuse past the window
signs them out. There is no "remember me" checkbox — staying signed in is the default and the
only mode. Stories 21, 22, 23.

Non-enumerating responses. Two flows deliberately reveal nothing about which emails exist. A
failed sign-in shows one generic message that does not say whether the email or the password
was wrong. A reset request shows one generic confirmation whether or not the email is
registered and regardless of the account's status. The UI renders exactly the message the API
returns and never branches its wording on the reason. Stories 18, 27.

Password entry. Wherever a user sets a password (accept and reset-consume), the field rejects
an empty or obviously too-short value; the minimum-length rule lives in the shared zod contract
so the client and the API enforce the same threshold, and the client check is a convenience,
not the authority. There is no advanced policy, no strength meter, no confirm-by-retype
requirement mandated here beyond the minimum. Story 36.

Routing. The four screens are unauthenticated routes. Accept and reset-consume are reached only
by following the one-time link from an email; they read their token from the link. An
authenticated user who lands on a pre-auth route is sent into the app; an unauthenticated user
who lands on an in-app route is sent to login.

## Screen: Login

Entry. The app's front door for anyone not signed in, and the redirect target for an
unauthenticated user or an expired or revoked session. Stories 17, 19, 20.

Fields and actions. Email and password, and a submit action. The language toggle is present.
Email is matched case-insensitively by the API, so capitalisation never locks a user out
(story 20); the screen does not need to normalise it itself.

Success. The API returns a session token; the SPA stores it and enters the app. Story 17.

Failure. Wrong password, unknown email, and a not-yet-active account (invited or deactivated)
all produce the same single generic failure message; the screen shows it and stays on login,
password cleared. It never distinguishes the cases, so an attacker cannot tell a real email
from a fake one or a live account from a blocked one. Stories 18, 19.

A link to request a password reset is present for the forgotten-password case, leading to the
reset-request screen.

## Screen: Accept invite and set password

Entry. Reached only by opening the one-time link in an invite email (ADR-0008). The link
carries the invite token; the screen reads it on load. Stories 12, 13.

On load. Role and Location are not shown as editable at all because they were baked into the
invite and are immutable by the recipient (ADR-0005). The language toggle is present and
defaults sensibly; whatever the recipient picks here is saved as their preferred_language.
Stories 6, 7, 14.

The inviter-set display name is not rendered on this screen as built. Showing it read-only was
the original intent, but the auth API delivered under issue #25 exposes no pre-accept
invite-read endpoint, and the invite token is opaque and hashed at rest, so the SPA has nothing
to read the name from before the recipient submits. The name is still set by the inviter and
immutable by the recipient (ADR-0005) — it is simply not echoed back on the accept screen.
Surfacing it would need a new token-scoped invite-preview endpoint, which is out of scope for
the SPA slice (issue #35, this delivers the surface over the endpoints the earlier slices
shipped); if that preview is later wanted it is an API addition recorded on its own. This is a
build-time reconciliation of this document to what was delivered (operating standard rule 3).

Fields and actions. A new-password field (subject to the shared minimum-length rule) and a
submit action, plus the language toggle.

Success. Submitting sets the password, flips the user's status from invited to active, saves
the chosen language as preferred_language, and signs the user in — the API returns a session
token and the SPA enters the app directly, with no separate login step. Stories 14, 15.

Error states. A token that is expired, already used, revoked, or simply not valid fails with a
clear message telling the recipient to ask the inviter for a fresh link — not a generic
password error, because here the recipient is the legitimate holder and needs to know the link
is the problem. The screen does not offer a self-service resend; a new link comes from the
inviter resending the invite. Stories 11, 16.

## Screen: Reset request

Entry. Reached from the "forgot password" link on login, or directly at its route. Story 26.

Fields and actions. An email field and a submit action; the language toggle is present.

Result. The screen always shows the same generic confirmation — "if an account exists for that
address, a reset link is on its way" — whether or not the email matches a user, and whether the
matched user is active, invited, or deactivated. Only an active user actually receives an email
(invited and deactivated users get the same on-screen confirmation and no email, and a
deactivated user's request has no effect at all). The request is rate-limited per email and per
IP; when the limit trips the screen still shows the same generic confirmation rather than a
distinct "too many requests" message that would itself leak signal. Stories 27, 30, 33.

## Screen: Reset consume and set new password

Entry. Reached only by opening the one-time link in a reset email. The link carries the reset
token; the screen reads it on load. Story 28.

Fields and actions. A new-password field (shared minimum-length rule) and a submit action; the
language toggle is present.

Success. Submitting sets the new password and, as a security consequence the user does not have
to ask for, ends every one of the user's existing sessions — a compromised session is cut the
moment the account is recovered. After a successful reset the user is sent to login to sign in
with the new password. Story 29.

Error states. A reset token that is expired (they expire in about an hour), already used, or
invalid fails with a clear message telling the user to request a new reset link, with a path
back to the reset-request screen. Story 28.

## In-app: invite management (inviter surface)

This is the authenticated surface an Admin or Manager uses to provision people. It is described
here only to the depth this feature delivers; the broader user-management screen is out of scope
(issue #25).

Create an invite. The inviter supplies the invitee's email, display name, role, and Location.
What the form may offer is constrained by the acting principal, enforced by the API and mirrored
in the UI so the user is not offered a choice the API will reject: an Admin may pick any role
and any Location; a Manager may create only Employee invites and only for their own Location, so
the Manager's form fixes the role to Employee and the Location to their own rather than
presenting a choice. The role and Location the inviter picks are baked into the invite and
cannot be changed by the recipient. Stories 3, 4, 5, 6, 7.

On success the new user appears immediately in the inviter's user list with status Invited, so
outstanding invites are visible, and an invite email goes out. Story 8.

Resend and revoke. Each pending (Invited) user carries a resend action and a revoke action.
Resend issues a fresh link and stops the old one working; revoke cancels the invite and removes
the pending user from the list. Stories 9, 10.

## In-app: deactivate and reactivate (admin surface)

An Admin can deactivate a user and reactivate a deactivated one, from the user list. Described
to feature depth only.

Deactivate cuts access immediately — the user's sessions are revoked and sign-in is blocked —
while keeping the record, so past task and thread references still resolve; the user's row moves
to status Deactivated in the list rather than disappearing. Reactivate restores sign-in for a
returning staff member without re-provisioning. A deactivated user's reset requests have no
effect (covered on the reset-request screen above). Stories 31, 32, 33.

Freshness. Because the principal is read fresh on every request (ADR-0007), a deactivation, a
reactivation, or a role or Location reassignment takes effect on the user's very next action —
there is no cached role or scope to go stale, so the UI a user sees follows their current
assignment without a re-login. Story 34.

## In-app: session touchpoints

Stay signed in. As described under cross-cutting behaviour, the default and only mode is to stay
signed in across shifts and app restarts, with sign-out happening only on explicit logout,
deactivation, or about two weeks of genuine disuse. Stories 21, 22, 23.

Log out. A log-out action ends the current device's session immediately (the session row is
deleted server-side) and returns the user to login. Story 24.

Log out of all devices. A separate log-out-everywhere action ends every one of the user's
sessions at once, for the lost-or-stolen-device case, and returns this device to login. Story
25.

## Out of scope for this UI flow

- The visual design system, component styling, and layout — inherited from Clix-CRM and settled
  at build time, not specified here.
- Full user-management screens beyond the invite, resend, revoke, deactivate, and reactivate
  actions this feature needs (issue #25).
- Automated SPA UI tests for these screens, including their RTL/LTR rendering (issue #25);
  covered later by a minimal smoke or manual QA as a separate seam.
- Native (Capacitor) shell specifics — deep links into accept/reset and device-secure token
  storage — deferred with native itself (issue #25, ADR-0009). The bearer transport chosen now
  lets native drop in later without an auth change.
