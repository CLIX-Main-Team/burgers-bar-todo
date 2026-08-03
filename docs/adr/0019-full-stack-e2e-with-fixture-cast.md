# Full-stack e2e: a live API, a seeded Postgres, and a test-only fixture cast

Status: accepted. This continues ADR-0012's Playwright lane — the "real pipe, stubbed content"
smoke test that was always meant to be replaced once real coverage existed — by giving the e2e
lane a live backbone: the real API (the `server.ts` boot) and a seeded Postgres behind the
browser, loaded with a fixed test-only **fixture cast**. It sits over ADR-0006 (stateful
DB-backed sessions), ADR-0007 (list/invite scope enforced in the API), ADR-0005 (invite-only
provisioning and the seeded first admin), ADR-0008 (SMTP email), and ADR-0018 (the provider key
resolved fail-fast at boot). It does not touch any of those mechanisms; it exercises them through
a real browser. It arose while hardening the `/people` provisioning surface (#137/U2).

## Context

The e2e suite drives the real built SPA under `vite preview`, but every API call is stubbed at
the network edge with `page.route`, and the provisioning specs assert against hand-rolled stub
arrays living inside the spec files. Nothing in the lane ever talks to the real API or a real
database. So the two things the provisioning surface most needs proven end-to-end are not proven:
that the SPA and the real API agree on the shape and scoping of `/users`, `/auth/me`, and the
invite endpoints (ADR-0007); and that a real session (ADR-0006), real list scoping, and the real
invite lifecycle work through the browser. A stub can silently drift from what the API returns,
and a whole class of integration bugs is invisible to the lane meant to catch them. ADR-0012
anticipated this: its Playwright lane was "a real pipe, stubbed content," explicitly out of the
required set "until real E2E coverage exists." This is that coverage.

Two constraints shape the design. The suite runs `fullyParallel` with CI retries, so any shared,
mutated state is a flakiness source. And the real `server.ts` boot is not free: `resolveLlmConfig`
fails fast if the selected provider's key is missing (ADR-0018), and the boot wires the SMTP
mailer (ADR-0008), so invites send mail.

## Decision

### The e2e lane runs against a live API and a real Postgres

Playwright's `webServer` becomes a two-entry array: the real `server.ts` API, readiness polled on
`/health`; and `vite build && vite preview`, built with `VITE_API_BASE_URL` pointed at the API. A
Playwright **setup project** (a dependency of the browser project) runs after both are up — it
migrates, loads the fixture cast, signs each persona in through the real `POST /auth/sign-in`, and
saves a per-role `storageState` the other projects attach. Running provisioning after the servers
are up sidesteps the globalSetup-vs-webServer ordering trap, and it means every session is a real
session row (ADR-0006), not a fabricated bearer. One dedicated test still drives the real login
form; the rest reuse the saved state so the suite stays fast.

### The fixture cast is a distinct, test-only concept — never the production seed

"Seed" stays reserved for ADR-0005's idempotent, production-safe first-admin insert. The e2e
dataset is a separate thing — the **fixture cast** — a fixed ensemble of Locations and Users
(three roles × three statuses × two Locations plus a Location-less admin) that must never reach a
production database. It is built by a single new seam, `loadFixtureCast`, composed over the
*existing* repositories and services (the locations repository, and the invite → activate →
set-password and deactivate paths of the auth module) exactly as the API integration harnesses and
`seedAdmin` already build data — so every fixture row is schema-valid and produced by real
provisioning code, not raw SQL. The cast is documented in the e2e folder's `readme.md`; it is test
infrastructure, not domain vocabulary, so CONTEXT.md is untouched.

### Isolation: a read-only baseline plus own-your-mutations

The fixture cast is a **read-only baseline**. List, scope, and visibility tests only read it, so
they are inherently parallel- and retry-safe. The mutating tests (invite, revoke, resend) do not
touch the baseline; each creates its **own** uniquely-keyed invite via the real API and asserts on
that row. `fullyParallel` stays on against a single API and a single database, with no
reset-between-tests machinery and no per-worker databases — the cheapest model that is still
deterministic under retries.

### The real server is booted, satisfied by an e2e env

The lane boots the real `server.ts`, not a bespoke test entrypoint, so it proves the actual
production boot path. The e2e env satisfies that boot: a **dummy LLM provider key** to pass the
ADR-0018 fail-fast check (the assistant is never exercised here), and SMTP pointed at **mailpit**
(already in `docker-compose.yml`, ADR-0008) so invite emails sink instead of erroring the invite
endpoint.

### CI provisions Postgres as a service container — a deliberate divergence from ADR-0012

ADR-0012's `test-api` job keeps Testcontainers, which hands back a dynamic port. The e2e lane needs
a **fixed** `DATABASE_URL` shared by the setup step and the long-running API `webServer` child
process, which Playwright fixes at config-eval time — a dynamic port cannot cleanly reach it. So
the **e2e** job declares `postgres:17` and `mailpit` as GitHub Actions `services:` at fixed ports.
This does not reverse ADR-0012: `test-api` is unchanged and keeps Testcontainers. The two jobs
provision Postgres differently because they have different consumers — an in-process test harness
versus a long-running server that needs a stable URL. The local mirror is `docker compose up -d db
mailpit` against a dedicated `burgers_e2e` database.

### Stubs survive only where a real backend cannot produce the condition

Converting `people.spec` to live, the 409-duplicate test graduates to a real flow (invite an email
already in the cast). Two stubs remain by design: the 403-forbidden test — the manager UI offers no
role/Location controls, so it cannot *send* a forbidden request through normal flow (the API's own
rejection is covered by the #25 API tests, ADR-0007) — and the transport-failure test, for which a
running server has no unreachable-mid-test equivalent. The `account-menu` and `shell` specs move
onto real sessions; the pre-auth and cosmetic specs (`smoke`, `manifest`, `theme-toggle`,
`pre-auth-frame`) are left untouched, reading no fixtures and touching no session.

## Considered options

**Reuse Testcontainers for the e2e job, for parity with `test-api`.** Rejected: the dynamic
`DATABASE_URL` cannot be threaded into an already-spawned `webServer` without fighting the tool.
The service-container divergence is a one-line explanation (different consumer), and the parity it
sacrifices is cosmetic.

**A lean, auth-only e2e API entrypoint** (no LLM, a fake mailer) to avoid the dummy key and SMTP.
Rejected: it is a second server assembly that can silently drift from `server.ts` and walks back
the "everything real" intent. The dummy-key-plus-mailpit env is a one-time cost that buys the real
boot path.

**Extend the production seed (`seed.ts`) with the demo cast behind a flag.** Rejected: it turns the
production-critical first-admin seed into a loaded gun and overloads "seed" to mean two different
things. The fixture cast is a separate, test-only path with no route to production.

**Per-worker databases, or reset-to-fixtures between tests.** Rejected as unnecessary: the
read-only-baseline plus own-your-mutations model keeps `fullyParallel` and retry-safety on a single
database, without N-database orchestration or a reset that would have to preserve the personas'
session rows.

## Consequences

The Playwright lane stops being a smoke test and becomes real coverage of the provisioning surface:
real sign-in and sessions, real list scoping across Locations, and the real invite/revoke/resend
lifecycle, all through a browser against the same `server.ts` prod ships. A drift between the SPA
and the API contract now fails a test instead of shipping. Per ADR-0012's enforcement note, the
`e2e` context is already recorded, so promoting it into the required set once real coverage exists
is a configuration change, not a workflow edit.

CI gains a Postgres and a mailpit service on the e2e job, and the e2e env (dummy provider key,
mailpit SMTP, a fixed `burgers_e2e` `DATABASE_URL`, the preview `CORS_ORIGIN`) must be marshalled
where the lane runs; `.env.example` already documents the shape. Because there is no reset between
tests, the personas' session rows persist for the whole run and their `storageState` tokens stay
valid.

This notes forward, without editing (rule 6), its relationship to ADR-0012 (whose Testcontainers
`test-api` job stands unchanged, and whose stubbed Playwright lane this fulfils), ADR-0005 (whose
"seed" this deliberately does not extend), ADR-0006, ADR-0007, ADR-0008, and ADR-0018 (the
mechanisms this exercises). CONTEXT.md is untouched: the fixture cast is test infrastructure, not
domain vocabulary. The build is specified in issue #151 (`ready-for-agent`).
