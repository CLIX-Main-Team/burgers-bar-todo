# Auth — implementation plan

The implementation plan for the authentication feature: the full invite-only email/password
auth surface, delivered as one unit together with the ADR-0010 foundation it stands on. This is
a rule-4 planning artifact; its spec (PRD input) is GitHub issue #25, its screens are in
ui-flow.md alongside this file, and it rests on ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009,
and ADR-0010. The Engineering Design (docs/engineering-design.md) is the how of the wider app; this
plan is the how of this feature.

This plan is the what-and-in-what-order, with the module seams named. It is not itself the code
and does not settle file paths; the modules below are behavioural, matching how issue #25 and
the ADRs describe them.

## What this delivers

The whole auth surface as behaviour: a seeded first Admin; invite create, resend, revoke, and
accept/set-password; sign-in, current-principal, logout, and logout-all; password-reset request
and consume; and deactivate/reactivate. Plus the foundation this repository does not yet have,
because this is its first code: the npm-workspaces monorepo, the dockerized Postgres-and-mailpit
dev infrastructure, the Makefile, drizzle-kit migrations, the seed script, split-origin dev
servers, and the env layout (ADR-0010).

## Gates and review

This feature is security-sensitive under operating-standard rule 5: it owns argon2id hashing,
opaque session issue and validation, the single-use invite and reset token flows, and
deactivation. Human review before merge is mandatory for the feature as a whole, and two points
inside it are the specific pause points to call out for review — the database migration that
creates the auth tables, and the security-critical module code (session validation, token
issue/consume, the non-enumeration and rate-limit logic, the provisioning constraints).

Before implementation starts, rule 4 also requires the Test Cases derived from the acceptance
criteria in issue #25's user stories. This plan and ui-flow.md are two of the three remaining
rule-4 artifacts; the Test Cases are the third and are written from the same stories that
ui-flow.md and the test matrix below trace to.

## Module seams

The design goal is a small number of deep modules with narrow interfaces, so the auth module can
later be extracted into a reusable clix package (ADR-0006) without publishing it now. Each seam
below hides its mechanism behind a simple interface; the two that must be substituted in tests
(mailer, clock) are ports from the start, and the data-access layer exposes no unscoped path
(ADR-0007). Interfaces are designed before their implementations.

- Mailer port. One behaviour — send a message to a recipient — behind a transport-agnostic
  interface, with a single env-driven nodemailer SMTP implementation (ADR-0008): mailpit locally,
  Gmail in prod, same code path. A capturing fake implementation of this same port is the test
  double; nothing else about mail is mocked. The port hides SMTP configuration and message
  construction from its callers.

- Clock port. One behaviour — the current time — injectable so every expiry case (invite ~1
  week, reset ~1 hour, session ~14-day idle) is deterministic in tests without waiting or
  touching the system clock. Direct manipulation of a row's expires_at is the equivalent lever
  where it reads more clearly; the plan allows either.

- Password hasher. Hash and verify over argon2id defaults (ADR-0006), with cost parameters
  tunable by env so tests can lower them for speed — a timing change, not a behaviour change.
  Verification is behavioural: a credential is confirmed by a successful sign-in, never by
  inspecting a hash.

- Token primitive. The one shared primitive behind both invite and reset (ADR-0006, ADR-0010):
  generate an opaque random value, store only its hash, carry the raw value in the link once and
  never persist it, and issue/consume it single-use with a purpose (invite or reset) and an
  expiry against the single auth_tokens table. Invite and reset differ only in purpose and
  lifetime, so they are one module, not two.

- Session service. Issue a session for a user (returning the raw bearer token), validate a
  presented token against its sessions row and extend the sliding idle window on use, and revoke
  — one session (logout) or every session for a user (logout-all, and as a side effect of a
  completed reset or a deactivation). Revocation is a row delete and is immediate.

- Auth middleware and principal. Resolve the bearer token to its sessions row on every request
  and produce a principal — user id, role, location id, status — read fresh from that lookup and
  attached to the request context (ADR-0007), so a reassignment or deactivation is honoured on
  the very next request. Invited and deactivated users do not authenticate.

- Scoped data-access. A user/session/token repository exposing only principal-parametrised
  methods; there is no unscoped path a caller could reach without a principal (ADR-0007). This is
  the auth-feature slice of the wider enforcement discipline; the task-board scope predicates are
  a later feature and out of scope here.

- Invite/provisioning service. Create (enforcing from the principal that a Manager may create
  only Employee invites for their own Location and an Admin may invite any role to any Location —
  never trusting client-supplied role or Location), resend (fresh token, prior one invalidated),
  revoke (token invalidated, pending user removed), and accept (validate token, set password and
  preferred_language, flip status invited to active, issue a session). Creating an invite creates
  the users row immediately with role and Location set and status invited.

- Reset service. Request (single non-enumerating response; only an active user triggers a real
  email; rate-limited per email and per IP) and consume (validate token, set new password,
  invalidate the user's other outstanding reset tokens, revoke all the user's sessions).

- Seed-admin script. Idempotent and env-driven (ADR-0010): read SEED_ADMIN_EMAIL and
  SEED_ADMIN_PASSWORD, hash through the same argon2id path sign-in uses, and upsert one user
  (role admin, location null, status active). The same script is `make seed` locally and the
  one-off prod insert of ADR-0005.

## Build sequence

Foundation first, then schema, then the module seams before the endpoints that use them, then
the SPA, with the integration suite grown alongside the API slices rather than bolted on at the
end. The order follows the dependency chain: nothing downstream can be exercised until the
foundation and schema exist, and the endpoints are only as trustworthy as the seams beneath
them.

1. Foundation scaffold (ADR-0010). The npm-workspaces monorepo (apps/web, apps/api,
   packages/shared); docker compose for Postgres 17 and mailpit; the Makefile front door
   (setup, up, down, reset, dev, generate, migrate, seed, logs); the drizzle-kit config; the
   root .env plus committed .env.example and apps/web/.env.local holding only VITE_API_BASE_URL;
   and split-origin dev servers (web ~5173, API ~3000) so CORS and the bearer path are exercised
   in development. Confirm the Postgres major against the Supabase project and pin it exactly
   (never :latest). Done when `make setup` takes a fresh clone to a running, migratable system.

2. Schema and first migration. The three tables (ADR-0010) via drizzle-kit generate — users
   (password_hash nullable), sessions (opaque token_hash, expires_at, last_used_at), and the
   single auth_tokens (purpose enum invite or reset), with the enums (role, status,
   preferred_language) and the case-insensitive-unique email. Versioned SQL committed and
   reviewed; no drizzle-kit push. This migration is a rule-5 review pause point.

3. Shared contracts. The zod schemas for the auth operations in packages/shared, including the
   password minimum-length rule the SPA and API both enforce, wired into Fastify via
   fastify-type-provider-zod. Defining the contracts here lets the API and the SPA build against
   one source.

4. Auth module seams. Implement the seams above — mailer port and its SMTP and fake
   implementations, clock, password hasher, token primitive, session service, scoped
   data-access, invite/provisioning service, reset service — designing each interface before its
   implementation. This is the security-critical core and the main rule-5 review pause point.

5. API endpoints (ADR-0007 enforcement). The operations from issue #25, over the shared
   contracts, with coarse role guards at the routes (tier one) and no unscoped data-access path
   (tier two): create invite (constrained by principal), resend, revoke, accept (token-bearing,
   pre-auth), sign in, read current principal, logout, logout-all, request reset (pre-auth,
   non-enumerating, rate-limited), consume reset, deactivate, reactivate. The auth middleware
   producing the fresh per-request principal is part of this step.

6. Seed-admin script. The idempotent env-driven upsert, run as `make seed`.

7. SPA screens (ui-flow.md). The four pre-auth screens — login, accept/set-password,
   reset-request, reset-consume — bilingual and direction-aware (he/en, RTL/LTR) since
   preferred_language may not exist yet, plus the in-app session touchpoints (logout,
   logout-all) and the right-sized invite and deactivate surfaces. Bearer token stored in
   persistent client storage and sent on every call.

8. Integration test suite. Grown alongside steps 5 to 7, not deferred: the single Fastify HTTP
   seam driven by app.inject(), a real ephemeral Postgres 17 via Testcontainers migrated fresh,
   the capturing fake mailer, and the injectable clock, asserting external behaviour only. This
   suite establishes the API integration-test pattern the later task-board and Assistant
   features reuse. The red-green-refactor discipline of the project's tdd approach applies:
   each API slice in step 5 is driven by its failing integration test first.

## Testing approach

One seam, external behaviour only (issue #25). Tests drive the Fastify HTTP boundary in-process
via app.inject(), assert on status and body and on state observed through a follow-up API call
(never by reading rows or calling internal helpers), and assert on captured outbound mail by
driving the issued one-time link back through accept or consume. Three dependencies are
substituted by injection: a real ephemeral Postgres 17 (Testcontainers, migrated fresh — real
SQL, constraints, and enums, not a mock or SQLite), the capturing fake mailer port, and the
injectable clock. The test environment may lower argon2id cost for speed. No test inspects a
password hash, a token at rest, or any private function.

The suite is thorough by design, covering the security negatives as exhaustively as the happy
paths — the coverage matrix is in issue #25 (invite constraints and token lifecycle; sign-in
non-enumeration and status/case behaviour; session validity, sliding window, logout and
logout-all; reset non-enumeration, single-use, all-session revocation, and rate limits;
deactivation immediacy and principal freshness). The Test Cases document (rule 4, still to be
written) enumerates these as cases traced to the user stories; this plan does not restate them.

SPA UI testing is out of scope for this feature (issue #25).

## Risks and one-way doors

- Postgres major pin. A silent major jump via :latest would diverge local from the Supabase
  prod engine on exactly the surface auth exercises; the pin is exact and confirmed at
  provisioning (ADR-0010).
- No signing secret. The env surface deliberately has none. "Log in once" is the sliding session
  plus persistent client storage (ADR-0006), not signing; adding a session-signing secret would
  reverse ADR-0006 and needs its own superseding ADR and human review, not an env line — not a
  quiet implementation choice.
- Bearer-on-web XSS exposure. The web session token lives in JavaScript-reachable storage
  (ADR-0006's accepted trade-off); the strict Content-Security-Policy is the primary defence with
  no httpOnly backstop, and it is load-bearing, not a nice-to-have. Keep it in view when building
  the SPA.
- Unscoped data-access. The failure mode ADR-0007 names is a raw, unscoped query slipping in;
  the data-access layer must expose no path without a principal, from the first repository method
  written.
- First-in-repo pattern. This suite and this module shape are the templates later features copy,
  so the seams and the test harness are worth getting clean now rather than reworking later.

## Definition of Done (this feature)

Acceptance criteria in issue #25's user stories satisfied; the integration suite at the single
HTTP seam passing across the happy paths and the security negatives; the delivered pre-auth
screens matching ui-flow.md (or ui-flow.md updated to match); docs and Engineering Design and the
folder readmes consistent in the same change; an ADR recorded if any new decision surfaces during
the build; no unresolved TODOs; and rule-5 human review passed before merge, with the migration
and the security-critical code as the named review points.

## Traceability

Issue #25 (spec / PRD input) → ui-flow.md and this plan.md → Test Cases (to be written) → the
GitHub issues under map #10 → the pull request. Depends on ADR-0005 (invite-only provisioning),
ADR-0006 (owned auth, stateful sessions, bearer everywhere), ADR-0007 (API-layer enforcement,
fresh per-request principal), ADR-0008 (Gmail SMTP mailer seam), ADR-0009 (the SPA plus
dedicated-API stack), and ADR-0010 (npm-workspaces monorepo, dockerized dev environment, the
three-table schema and env surface).
