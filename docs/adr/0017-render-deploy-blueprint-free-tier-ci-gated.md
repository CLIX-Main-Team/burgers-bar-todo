# Deploy on Render from a committed Blueprint, free tier, with migrations gated in CI

Status: accepted. Decided in the render-blueprint grilling (issue #112), using
/grilling + /domain-modeling. Records the deploy/CD pipeline that ADR-0009 and
engineering-design.md left "deferred to the build — not yet specified", and the move
to the free tier together with the functional trade-off that move carries. Does not
reverse ADR-0009's Render / SPA-split / Fastify decisions — see "Relationship to prior
ADRs".

## Context

ADR-0009 fixed the hosting *shape*: the API is a Render Web Service, the SPA a Render
Static Site, and the database the existing external Supabase Postgres reached over
Drizzle. It deliberately left the *pipeline* — how code and schema actually reach those
services — unspecified, and it assumed a paid, always-on API instance, rejecting the
free tier because "spin-down would break the in-process Drive sync and cold-start the
synchronous LLM call".

Two things forced this decision now. First, the app is ready to deploy and needs a
reproducible, reviewable way to provision both services rather than hand-clicked
dashboard state. Second, the budget for this delivery-first client is the Render free
tier, not the paid instance ADR-0009 assumed. That reopens the pipeline question on
harder terms: the free tier has no `preDeployCommand`, so the natural "migrate, then
cut over traffic" safety has to be rebuilt elsewhere.

## Decision

The whole deployment is infrastructure-as-code in a committed `render.yaml` Blueprint
at the repo root, declaring both services. Supabase is never declared there — it is
external, referenced only by the `DATABASE_URL` secret.

- **API — Docker web service on the free tier**, `region: frankfurt`, health check at
  `/health`. The image (`node:22-slim`, built with the repo root as context) runs the
  TypeScript entrypoint directly with `tsx` — there is no compile step, `tsx` moves
  from a dev- to a runtime dependency, and `@burgers/shared` is imported as source.
  Debian slim, not alpine, so `@node-rs/argon2`'s prebuilt glibc binary resolves. The
  server binds Render's injected `PORT`.
- **SPA — static site on the free CDN**, built from the repo root, SPA-rewriting `/*`
  to `/index.html`. It is the CSP enforcement point: the full policy is a response
  header (including `frame-ancestors 'none'`, which a meta tag cannot express), with
  `connect-src` pinned to the API's `onrender.com` origin as a literal. Fingerprinted
  assets are cached immutably; the entry document must revalidate.
- **Env surface** is declared in the Blueprint in full: non-secret config as literals
  (`NODE_ENV`, the Gmail SMTP host/port/secure, the cross-service origins), every
  secret as a `sync: false` key — name committed, value supplied in Render. It mirrors
  the repo's committed `.env.example`.
- **Cross-service origins are pinned literals** (`https://burgers-bar-api.onrender.com`,
  `https://burgers-bar-todo.onrender.com`), derived from the chosen service names.
  `fromService` yields a bare host with no scheme and `render.yaml` cannot concatenate,
  so `@fastify/cors`, the invite/reset link builder, and the CSP header all take
  literals.
- **CD — migrations gated in CI, then deploy hooks.** Neither service auto-deploys
  (`autoDeploy: false`). A GitHub Actions job, gated on the CI workflow going green on
  `main`, applies the committed Drizzle migrations to the production database and, only
  on success, fires the two Render Deploy Hooks (API before SPA). A broken migration
  fails the job and nothing deploys — the free-tier substitute for `preDeployCommand`.
- **The first admin is seeded once, by hand** (ADR-0005), against the production
  database, documented in `docs/deploy/readme.md`. `SEED_ADMIN_PASSWORD` — the single
  most privileged credential — is used for that one run and never becomes a standing
  secret.

## Considered options

- **Paid, always-on API (ADR-0009's assumption).** Rejected on budget. It would have
  kept `preDeployCommand` and the unattended Drive backstop; those are what we give up.
- **Native Node runtime instead of Docker.** Lighter config, but Docker was chosen for
  environment control and CSP/header parity; the Dockerfile is small because there is no
  build step.
- **Compiling or bundling the API instead of running `tsx` in the image.** A smaller,
  dev-tooling-free runtime image, but `@burgers/shared` is source-only, so `tsc` needs
  project references and a bundler needs config for the native deps and the
  migrate/seed entrypoints. Not worth it for a two-feature internal app; running `tsx`
  matches dev exactly. Bundling stays the clean upgrade path if the image ever matters.
- **`preDeployCommand` for migrations.** The first choice, and unavailable on the free
  tier — which is why migrations moved to CI.
- **Independent auto-deploy on push, no CI gate.** Simpler, but with advisory-only CI
  (ADR-0012) it would ship red builds and let code and schema race. The CI-gated hook
  is what buys back both guarantees.
- **Custom domains.** Cleaner CSP and stable origins, but no domain is provisioned yet;
  `onrender.com` defaults with pinned literals are the v1 choice.

## Consequences

- **The API spins down when idle and cold-starts on the next request.** First use after
  a quiet stretch is slow, then warm.
- **The unattended Drive backstop poll degrades.** A spun-down service runs no
  `setInterval`, so the Assistant's *background* freshness guarantee (ADR-0014, #89)
  effectively does not hold on the free tier. Login-triggered fire-and-forget sync and
  manager/admin manual resync still work, because a request wakes the service. This is
  the surprising, functional cost of the tier move and the reason it is recorded as an
  ADR rather than a silent design-note edit — a future reader will otherwise wonder why
  the backstop "does not work".
- **The future live board (ADR-0015) will meet the same spin-down.** An SSE channel
  keeps the service awake only while a client is connected; overnight it sleeps. To be
  weighed when that slice is built, not now.
- **The CSP `connect-src` and the cross-service origins are coupled to the service
  names.** Renaming a service means updating the literals in `render.yaml` together;
  the names were chosen to be stable for that reason.
- **The runtime image carries `tsx` and transpiles on boot.** Negligible for a
  long-lived service; the cost is paid at deploy/restart, not per request.
- **A brief version-skew window exists** between the API and SPA deploys the hooks
  trigger; deploying the API first keeps a new client from talking to an older server,
  and additive migrations keep an older client working against the new one.
- **Production DB SSL rides on the connection string.** `createDb` passes only the
  `DATABASE_URL`; Supabase's session-pooler string carries `sslmode=require`, and `pg`
  honours it. No SSL is hardcoded, so the Testcontainers test harness keeps talking to
  a plain local Postgres unchanged.
- **The free tier has a monthly instance-hours cap.** Sufficient for one small API, but
  a real ceiling to remember before adding more free services.

## Relationship to prior ADRs

ADR-0009 stands: Render, the SPA-plus-dedicated-API split, and Fastify are unchanged,
and this ADR does not reverse them. ADR-0009 itself classifies the *plan tier* as a
volatile specific that lives in `engineering-design.md` ("Changing one of those edits
the design note"), so the tier *value* is updated there, not here. What this ADR records
is the part that is more than a knob: the deploy/CD pipeline ADR-0009 left unspecified,
and the fact that going free-tier contradicts a functional rationale ADR-0009 gave
(spin-down was rejected for breaking the Drive sync) — a real trade-off, now accepted
with eyes open. It builds directly on ADR-0006 (the bearer token the CSP `script-src`
guards), ADR-0008 (the Gmail SMTP config in the env surface), ADR-0012 (the CI workflow
this deploy gates on), and ADR-0014 (the backstop that degrades).
