# Engineering Design — Burgers Bar staff app

The design the v1 build starts from: how the app fits together, once the residual engineering
decisions (auth, API framework, permission enforcement, hosting) are resolved. It ties the
architecture decision records together into one picture and points at each for the rationale.
The product and data model are fixed in docs/prd.md; this is the how, not the what.

This is a living document. The decisions it rests on are immutable ADRs; the concrete specifics
here — versions, region, plan tiers, environment variables, the monorepo's exact shape — change
as the build proceeds, and they change here rather than in an ADR. Reversing a decision, not
adjusting a specific, is what writes a new ADR.

The foundational decision is ADR-0009: a client-rendered SPA talking to a dedicated Node API,
inheriting Clix-CRM's frontend and dropping its Next.js server layer. Everything below is that
decision worked through.

## Shape

A pnpm-workspaces monorepo with three packages:

- apps/web — the SPA. Vite plus React 19 plus React Router, client-rendered. TanStack Query
  for server state, react-hook-form plus zod for forms, use-intl for internationalization.
  Clix-CRM's React 19 components, Tailwind v4, and shadcn/ui are inherited; its message files
  and t() calls port near-verbatim, keeping Hebrew/English RTL/LTR.
- apps/api — the API server. Fastify on persistent Node, over Postgres through Drizzle ORM.
  Holds the auth module, the permission-enforcement layer, the assistant service, and the
  Drive-sync job.
- packages/shared — the zod schemas used on both sides. The SPA-to-API contract is plain typed
  fetch plus these shared schemas; zod is wired into Fastify via fastify-type-provider-zod.
  There is no framework-specific RPC client.

Tooling ports from Clix-CRM: TypeScript, Biome, Vitest, Playwright, pnpm.

## Request path

A request runs SPA to Fastify to Drizzle to Postgres. The browser (or later the Capacitor
WebView) calls the API across origins with a bearer token in the Authorization header; there is
no browser-to-database path. On the API, the auth middleware resolves the token to its session
row and attaches a per-request principal; the enforcement layer reads that principal and nothing
the client sent; the data-access layer runs principal-scoped Drizzle queries against Postgres.

## Auth (ADR-0006)

Auth is an owned module inside apps/api, self-contained with clean storage and transport seams
so it can later be extracted into a reusable clix package — no third-party framework, no vendored
deprecated library. Sessions are stateful and DB-backed: an opaque server-owned token looked up
on every request, so revocation is immediate and role and location are always read fresh.
Passwords are argon2id. Transport is a bearer token everywhere — on native the token lives in
device-secure storage (Keychain / AndroidKeyStore), on web it unifies on the same bearer rather
than an httpOnly cookie, because the SPA and API cannot commit to one registrable domain. Session
lifetime is a sliding roughly 7-day idle expiry. Invite and password-reset share one hardened
token primitive: opaque, hashed at rest, single-use, expiring. This is security-critical code and
carries rule-5 human review on every change.

The bearer-on-web trade-off (a session token reachable by JavaScript, so XSS could exfiltrate it)
is accepted and mitigated by a strict Content-Security-Policy at the source and the instant
stateful revocation the session model provides. The strict CSP is load-bearing here, not a
nice-to-have.

## Permission enforcement (ADR-0007)

Enforcement lives in the API layer, as two tiers over the one per-request principal; the database
is a trusted store with no RLS backstop. Tier one is coarse role guards at the route (task
create/assign/edit/delete and user provisioning require manager or admin; the status-only path
requires an authenticated user). Tier two is mandatory scope predicates in the data-access layer:
admin is chain-wide, manager is filtered to their location, employee is filtered to tasks whose
assignee set contains them. The task data-access module exposes only principal-parametrized
methods — there is no unscoped get-all or update that a caller could reach without a principal.

Two write paths keep the employee status-only rule structural rather than a runtime filter: a
full-update method gated to manager and admin, and a separate updateTaskStatus method that
verifies assignee membership and writes only the status column. Employees are routed solely to
updateTaskStatus. Chat writes happen only inside the assistant service, so an agent turn cannot be
forged from the browser, and thread reads are scoped to the author. The failure mode to guard
against is a raw, unscoped Drizzle query against tasks or threads; this layer is security-critical
and carries rule-5 review.

## Assistant and knowledge base (ADR-0003, ADR-0004)

The assistant service in apps/api makes a direct, synchronous LLM call — the Anthropic Claude SDK,
latest model — with no webhook or callback. Because it is synchronous and can run long, the API is
persistent Node rather than edge or serverless (ADR-0009), so no platform wall-clock ceiling cuts
it off. The knowledge base is authored in a shared Google Drive folder and mirrored into a local
cache by a sync job that runs in process (a worker or cron inside the persistent server), for the
same reason: a spin-down would break it. Retrieval that grounds an answer is capped at the
principal's own visibility (the task scope predicate plus the chain-wide knowledge cache), so the
assistant is not a way around the three-role model.

## Internationalization

Hebrew and English, RTL and LTR, are a functional requirement carried from the PRD, not a
non-functional nicety. use-intl (next-intl's framework-agnostic core) lets Clix-CRM's message
files and t() calls port near-verbatim. The pre-auth surfaces — login, invite-accept,
password-reset — must honour the toggle before a user's preferred_language exists.

## Hosting (ADR-0009)

Split tiers, right-sized for a small delivery-first client, vendor defaults accepted.

- API — a Render Web Service, persistent Node running Fastify, paid and always-on. Not the free
  tier, whose spin-down would break the in-process Drive sync and cold-start the synchronous LLM
  call.
- SPA — a Render Static Site on the free global CDN, auto-HTTPS, custom domain, SPA rewrite to
  index.html. Serves the installable PWA (manifest plus service worker).
- Database — the existing Supabase Pro Postgres used as plain Postgres via Drizzle, over the
  session-pooler string with a small server-side pool (not a connection per request). Supabase is
  the managed Postgres here, not its Auth or PostgREST.

The API and database are co-located, EU/Frankfurt target, exact region pinned at provisioning —
the one sticky one-way door, since a live-Postgres region move is a dump-and-restore with
downtime. Everything else is portable. Environment is prod-only hosted plus local dev; Supabase
Pro Branching covers migration testing; there is no standing staging.

Secrets live in Render environment variables — DATABASE_URL, the auth signing secret,
ANTHROPIC_API_KEY, the Google Drive credentials, and later an email-provider key (ADR-0008, Gmail
SMTP). Local development uses a gitignored .env with a committed .env.example; the SPA receives
only the public VITE_ API base URL. There is no dedicated secrets manager.

## Deferred to the build

- Native wrapping — v1 ships the browser SPA as an installable PWA; Capacitor native store builds
  (on-device token storage, deep links, push registration, app-store packaging) are a later
  build-time concern, taken up when native work starts.
- Realtime — the chatbot is synchronous, so it needs none; whether the task board needs live
  updates versus TanStack Query polling is a build decision, likely polling in v1.
- CI/CD — the deploy pipeline that builds and pushes to the two Render services is not yet
  specified. Environment and secrets management itself is decided above.
- Offline behaviour on the native shell — not specified; likely out for v1, confirmed when native
  work starts.

## Where the decisions live

- ADR-0001 — three-role model (admin, manager, employee).
- ADR-0002 — employee status-only write (mechanism now ADR-0007).
- ADR-0003 — direct synchronous chatbot LLM call.
- ADR-0004 — Google Drive knowledge-base sync.
- ADR-0005 — invite-only provisioning (auth mechanism now ADR-0006).
- ADR-0006 — owned auth module, stateful sessions, bearer transport.
- ADR-0007 — permission enforcement in the API layer.
- ADR-0008 — Gmail SMTP for transactional email.
- ADR-0009 — the SPA plus dedicated-API stack this design realizes.
