# Owned auth module with stateful DB-backed sessions and bearer-everywhere transport

Status: accepted. Supersedes the Supabase-Auth mechanism assumption in ADR-0005; the
invite flow, roles, and soft-deactivation semantics fixed there are unchanged and still
stand.

The architecture rebuilds auth inside the dedicated Node API on Postgres/Drizzle — there
is no Supabase. (Research #11 framed this as a Hono API; grilling #13 later fixed the
framework as Fastify with zod via fastify-type-provider-zod. Nothing in this ADR depends
on the framework — the module is plain Node middleware — so the shift does not alter any
decision here; it only removes the Hono-specific better-auth recipe, which is moot given we
hand-roll.) This ADR settles how, implementing ADR-0005's
invite-only email/password flow. It is the outcome of the grilling on ticket #12 and is
security-sensitive under rule 5.

## Decision

Build the auth ourselves as a self-contained module in the monorepo (alongside the shared
zod package), shaped to the three roles plus location, with clean storage and transport
seams so it can later be extracted into a reusable clix auth package. No third-party auth
framework (better-auth) and no vendored deprecated library (Lucia); we own the code. Public
NPM publication is explicitly not a goal now — it is a later, separate decision.

Sessions are stateful and DB-backed. The credential is an opaque, server-owned session
token looked up against a sessions row on every request. Revocation is a row delete and
takes effect immediately; the user's role and location are read fresh from that lookup on
each request, so a location reassignment or a deactivation is honoured on the very next
request. No stateless JWT and no signed claims.

Passwords are hashed with argon2id (@node-rs/argon2 or node-argon2, argon2id defaults).

Transport is a bearer token everywhere. On native the Capacitor WebView is cross-site to
the API, so cross-site cookies are blocked and the token must travel as an Authorization:
Bearer header, held in device-secure storage via capacitor-secure-storage-plugin (Keychain
on iOS, AndroidKeyStore on Android) — not @capacitor/preferences, which is unencrypted. On
web we unify on the same bearer token rather than an httpOnly cookie, because we cannot
commit to serving the SPA and API under one registrable domain; a cross-domain auth cookie
would be a third-party cookie that browsers are phasing out.

Session lifetime is a sliding idle expiry: a rolling window, default roughly 7 days,
extended on each authenticated request, held as a tunable config value of the module.
Explicit logout and deactivation revoke instantly on top of this. This refines ADR-0005's
"persistent until logout" rather than contradicting it.

Invite links use an opaque random token, single-use, roughly 7-day expiry, with only its
hash stored at rest. Role, location, expiry, and used-state live on the server-side
invite/pending-user row; the token is only the lookup key, so ADR-0005's "immutable role
and location" is structural — the recipient holds nothing but a random string. Resend
issues a fresh token and invalidates the prior one; revoke invalidates the token and
removes the pending user.

Password reset uses the same token primitive with a roughly 1-hour expiry. The request
endpoint gives a single non-enumerating response whether or not the email matches a user;
only an active user triggers a real email (invited and deactivated users get the generic
response and no effect). The token is single-use and invalidates other outstanding reset
tokens; a successful reset revokes all of the user's existing sessions. Requests are
rate-limited per email and per IP.

## Considered options

better-auth (a maintained framework) was the main alternative. It was rejected because the
native shell erodes its central advantage: better-auth is cookie-first, but the Capacitor
cross-site-cookie block forces its opt-in bearer plugin (documented "use cautiously") with
no first-party Capacitor integration, so its convenience largely evaporates on the surface
we most need it. On top of that it imposes its own schema and vocabulary (ban rather than
deactivate, organization rather than location, scrypt rather than argon2id) and its
single-use set-password invite is custom work anyway. Lucia was rejected because it is
deprecated as a library in 2026 — adopting it means vendoring reference code you own with
no upstream patches, which is hand-rolling with a template rather than a maintained
dependency. Full comparison in research #11.

Stateless JWT was considered and rejected for the session model: it cannot revoke a live
access token, so soft-deactivation would lag until the token expired, and signed
role/location claims would go stale across a reassignment. Stateful sessions buy instant
revocation and always-fresh scope at the cost of a per-request lookup, which is negligible
at this scale where the DB is already in the request path.

An httpOnly cookie on web was preferred on security grounds (invisible to JavaScript, so
XSS cannot steal the session) but rejected because it requires the SPA and API to share a
registrable domain, which the deployment cannot commit to.

## Consequences

Unifying on a bearer token means the web session token lives in JavaScript-reachable
storage and can be exfiltrated by a successful XSS injection; httpOnly would have prevented
this and is not available. This is an accepted trade-off, mitigated two ways: prevent XSS
at the source (strict Content-Security-Policy, rely on React's default escaping, ban
dangerouslySetInnerHTML, keep dependency hygiene tight — with no httpOnly backstop this is
the primary defence, not a nice-to-have), and lean on the instant stateful revocation this
ADR chose (a session known or suspected stolen is killed immediately, and "log out all
devices" is available).

The module owns security-critical code (session issue and validation, argon2id wiring,
single-use token flows for invite and reset, deactivation) and every change to it triggers
rule 5 human review before merge.

The invite and password-reset flows share one hardened token primitive: opaque, random,
hashed at rest, single-use, expiring, with the raw value shown once and never stored.

Do not reintroduce a public signup route or a cross-domain auth cookie without revisiting
this ADR and ADR-0005.
