# npm-workspaces monorepo and a dockerized local dev environment mirroring prod

Status: accepted. This is the first build-tooling decision in the repo — until now it held
only documentation. It supersedes the pnpm-workspaces lean recorded in the #16 stack
direction (package manager only) and refines ADR-0006's tunable session window to a
concrete value; it does not touch the auth mechanism (ADR-0006), the invite/reset flows
(ADR-0005), the enforcement model (ADR-0007), or the mail transport (ADR-0008), all of
which stand. It arose from a grill-with-docs session scoping the login/auth build. The
local development environment it defines is not itself security-sensitive under rule 5; the
auth module it stands up is, and its implementation carries the rule-5 human-review gate
independently of this ADR.

## Context

The engineering foundation is fixed elsewhere: a Vite/React SPA, a dedicated Fastify API on
Postgres via Drizzle, and a shared zod package (#13, #14, #16). Prod runs the API on Render
against Supabase Postgres, sends transactional mail over Gmail SMTP (ADR-0008), and serves
the SPA cross-origin to the API with a bearer token and CORS (ADR-0006, #14). None of that
had a local counterpart, and the first feature to build — the full auth surface (seeded
admin, invite, accept/set-password, login, logout, password reset) — is exactly the surface
where local-versus-prod drift bites: cross-origin CORS, SMTP delivery, and Postgres engine
behaviour. Local dev has to mirror those three or the auth flow gets tested against a shape
it will not run in.

The team works in npm, not pnpm. This is a small client; the environment is sized
delivery-first, mirroring the parts of prod that change auth behaviour and not the parts
that are the host's concern.

## Decision

Monorepo tooling is npm workspaces. Three packages — apps/web, apps/api, packages/shared —
under a root package.json workspaces list, driven by npm (npm install, npm -w <pkg> run
...). This reverses the earlier pnpm lean; the reason is team familiarity, and the reversal
is cheap and non-structural (the three-package shape is unchanged). The #16 stack ADR, when
written, cites this decision for the package manager rather than restating pnpm.

Local infrastructure runs in Docker; the application runs on the host. docker compose stands
up two services — Postgres and mailpit — and nothing else. The Fastify API and the Vite dev
server run directly on the host for fast reload and native debugging. Containerizing the app
tier is not done: that parity is Render's build concern, and the parity that changes auth
behaviour (Postgres engine, real SMTP, cross-origin bearer) is fully achieved without it.

Postgres is the official postgres image, pinned to postgres:17, matching the Supabase project's
major version; the exact major is confirmed at provisioning and the pin is never :latest. The
vanilla image is used, not supabase/postgres, because the app uses Supabase as plain Postgres
via Drizzle — RLS and the rest of Supabase's surface were removed (ADR-0007), so bundling its
extensions would mirror a surface we deleted.

Web and API run on split origins locally (for example web on 5173, API on 3000), so CORS and
the Authorization: Bearer path are exercised in development rather than discovered in prod.

Mail goes through one env-driven SMTP mailer — the single ADR-0008 seam, unchanged. Local
points it at mailpit (host localhost, port 1025, no auth, no TLS; messages read in mailpit's
web UI on 8025); prod points it at smtp.gmail.com:587 over STARTTLS with the dedicated
account's App Password. The invite and reset services call the same sendMail seam in both
environments; only host, port, TLS, and auth differ. No separate console/log dev mailer.

The first admin is seeded by an idempotent, env-driven seed script in apps/api, run with tsx.
It reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD, hashes through the same argon2id path login
uses, and upserts one user (role admin, location null, status active). Locally it is make seed
against dev credentials; in prod the same script is the one-off insert ADR-0005 describes, run
once with real credentials, after which the admin invites everyone else.

Migrations use drizzle-kit generate plus migrate — versioned SQL committed under apps/api and
reviewed in the PR. Locally make migrate applies them to the docker Postgres; in prod they run
as a Render release step against Supabase's direct connection, with Supabase Branching (#14)
covering pre-prod testing. drizzle-kit push is not used: it leaves no reproducible, reviewable
artifact for a prod-bound, security-sensitive schema.

A Makefile is the front door: setup (npm install, compose up, wait-for-healthy, migrate, seed
— a fresh clone to a working system in one command), up and down (infra only, volume kept on
down), reset (compose down -v then up, migrate, seed — a clean-slate DB for testing invite,
reset, and deactivation states), dev (infra up then API and web dev servers concurrently on
split origins, with dev-api and dev-web for running one in isolation), generate, migrate, seed,
and logs.

Configuration is a single gitignored root .env plus a committed root .env.example, consumed by
docker compose, the API, and the seed/migrate scripts from one source; apps/web/.env.local holds
only VITE_API_BASE_URL, so no server secret can be VITE-exposed into the client bundle. The var
surface for this unit is the Postgres and mailpit settings, DATABASE_URL, the SMTP settings and
MAIL_FROM, the session and token lifetimes, API_PORT / CORS_ORIGIN / APP_BASE_URL, the seed admin
credentials, and the web's VITE_API_BASE_URL. There is deliberately no signing secret (see below).

The sliding session idle window is set to SESSION_TTL_DAYS=14. ADR-0006 fixed the mechanism (a
sliding idle expiry extended on each authenticated request) and called the window a tunable config
value with a ~7-day default; 14 days is that knob chosen, not a change of mechanism.

The auth schema for this unit is three tables: users (password_hash nullable — null while status
is invited, set on accept), sessions (opaque token_hash, expires_at, revoke by row delete), and a
single auth_tokens table with a purpose enum (invite or reset). One token table, not two: the
invite and reset tokens have identical columns because role and location live on the user row, so
auth_tokens is the direct expression of ADR-0006's one shared token primitive (opaque, random,
hashed at rest, single-use, expiring). The pending user is a user row (status invited), so there
is no separate pending_users table.

## Considered options

A fully dockerized stack, with the API and web also in containers, was rejected. It fights WSL2
file-watching, slows reload, and complicates debugging, and it still is not prod — prod is Render's
build, not a compose file. The parity that matters for auth is reachable with infra-only containers.

The supabase/postgres image was rejected in favour of vanilla postgres: it bundles pgjwt, pgsodium,
realtime, and other extensions the app does not use, mirroring a Supabase surface ADR-0007 removed.

A console/log dev mailer was rejected: it would exercise a different code path locally than the SMTP
path prod runs, defeating the point of testing invite and reset delivery. mailpit behind the real
seam tests the real path while keeping every message on the machine.

drizzle-kit push was rejected for a prod-bound schema: no migration file, nothing to review, no
ordered history — unacceptable for security-sensitive tables.

A signing secret for sessions was raised and rejected. The goal behind it — users logging in once
and staying logged in — is already delivered by ADR-0006's sliding idle session plus persistent
client-side token storage, which are properties of session lifetime and storage, not of signing.
Signing only removes the per-request DB lookup, and doing so would break the instant revocation
ADR-0006 and ADR-0007 depend on (a signed token cannot be revoked before it expires, and signed
role/location claims go stale across a reassignment). This reaffirms ADR-0006; adding a signing
secret to make sessions stateless would be a reversal of it and would need its own superseding ADR
and human review, not an env line. No signing secret is added.

Two separate token tables (invites, password_reset_tokens) were rejected in favour of one
auth_tokens table, per the one-shared-primitive decision above.

## Consequences

A fresh clone reaches a working, loggable-in system with one command (make setup), and make reset
gives a clean-slate DB on demand — the state churn auth testing needs (invited, active, deactivated;
fresh and consumed tokens). Nothing leaves the machine in development: mailpit catches all mail, so
no real Gmail credential is needed locally, and the non-enumerating reset response is observable by
reading mailpit rather than a real inbox.

The Postgres major must be confirmed against the Supabase project at provisioning and the pin kept
exact; a silent major jump (via :latest) is the failure mode to avoid.

There is no signing secret in the env surface. If a concrete, non-session signer ever appears it gets
its own purpose-scoped variable then; a session-signing secret specifically would reverse ADR-0006.

The auth module this environment stands up owns security-critical code (argon2id hashing, opaque
session issue and validation, the single-use token flows, deactivation) and every change to it triggers
rule-5 human review before merge — this ADR is the scaffolding around that module, not the module.

Doc ripple. The #16 stack ADR, when written, references this ADR for the package manager rather than
restating pnpm. Before implementation, rule 4 requires the auth feature's PRD, ui-flow, plan.md, and
Test Cases; the three-table schema and the env surface above feed the Engineering Design and plan.md.
CONTEXT.md is unchanged: this ADR is implementation and introduces no new domain vocabulary.
