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

An npm-workspaces monorepo with three packages:

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

Tooling ports from Clix-CRM: TypeScript, Biome, Vitest, Playwright. The package manager is
npm workspaces (npm install, npm -w <pkg> run ...), not Clix-CRM's pnpm (ADR-0010).

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
lifetime is a sliding idle expiry, set to 14 days (SESSION_TTL_DAYS) — the concrete value of
ADR-0006's tunable window (fixed in ADR-0010), not a change of mechanism. Invite and password-reset share one hardened
token primitive: opaque, hashed at rest, single-use, expiring. This is security-critical code and
carries rule-5 human review on every change.

The bearer-on-web trade-off (a session token reachable by JavaScript, so XSS could exfiltrate it)
is accepted and mitigated by a strict Content-Security-Policy at the source and the instant
stateful revocation the session model provides. The strict CSP is load-bearing here, not a
nice-to-have.

Password reset is non-enumerating: a request returns one generic confirmation whatever the email
is — matched or not, active or not, throttled or not — and only an active user has a token minted
and a link mailed. It is throttled per email and per IP over a fixed window, and a throttled
request returns the same confirmation, so the throttle itself leaks no signal. The limiter is
in-process (a single-node small deployment; a multi-node one would move it to a shared store). Its
per-IP half assumes the API sees the real client IP: run directly, request.ip is the client; run
behind a reverse proxy, the proxy and Fastify trustProxy must be configured so a client cannot
spoof X-Forwarded-For and dodge the limit. Completing a reset revokes every one of the user's
sessions and issues none, so a compromised session is cut the moment the account is recovered and
the user signs in afresh.

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

## Assistant and knowledge base (ADR-0003, ADR-0004, ADR-0013, ADR-0014)

The assistant service in apps/api makes a direct, synchronous LLM call through the OpenRouter
broker — a plain fetch to an OpenAI-compatible endpoint, no vendor SDK, routing to
`google/gemini-2.5-flash` by default with the model held in an `ASSISTANT_MODEL` config value for a
one-line swap (ADR-0013). Because it is synchronous and can run long, the API is persistent Node
rather than edge or serverless (ADR-0009), so no platform wall-clock ceiling cuts it off. The
answer is bounded (~800 output tokens, ~10 replayed turns, ~25s timeout); a failure is a transient
inline retry, never a persisted Message row (ADR-0003). An anti-fabrication system prompt confines
the answer to the injected context and replies in the question's language.

The knowledge base is authored in a Drive folder the client owns, shared to a read-only service
account (a free-plan folder-share, not a Shared Drive — ADR-0014), and mirrored into a local
`knowledge_docs` cache by an in-process sync job (a worker or cron inside the persistent server),
so a spin-down would not break it. One idempotent reconciliation function (`changes.list` from a
persisted cursor) is driven by usage: fire-and-forget on user login, a low-frequency backstop poll,
and a manual "resync now" — the `changes.watch` webhook is deferred (ADR-0014). Ingestion covers
Google Docs, text-layer PDFs, and DOCX; scanned PDFs are skipped and flagged, and each doc is
length-capped because grounding injects doc text directly (no embeddings). Retrieval that grounds
an answer is capped at the principal's own visibility — the task scope predicate reused from the
ADR-0007 read path, plus the chain-wide knowledge cache injected up to a token budget — so the
assistant is not a way around the three-role model.

## Logging (ADR-0011)

The API logs through Pino, Fastify's built-in logger, configured once on the single
Fastify-owned root logger — the one place levels, format, serializers, and redaction live; there
is no standalone logger module a second config could drift into. Fastify's per-request req/res
logging is the spine, carrying an auto `reqId`; domain events layer on through child loggers that
inherit it, each tagged with a `component` (auth, assistant, drive-sync, authz, system) and a
stable `event`, so logs are queried by field rather than by grepping messages. The Drive-sync
worker (ADR-0004), being request-independent, carries a per-run `runId` instead. Five levels
(fatal, error, warn, info, debug) run at info in prod and debug in dev; permission denials
(ADR-0007) log at warn. Output is pino-pretty in dev and newline-delimited JSON on stdout in
prod, which Render captures (the vendor default — no log drain or retention programme).

Logging is a privacy decision first. The policy is allow-list primary: custom req, res, and err
serializers emit only an explicitly chosen safe set (ids, scalars, route metadata), never whole
objects, with Pino's `redact` as a defense-in-depth backstop. The query string never reaches a
log line (it carries invite and reset tokens); PII is id-only (never email, display name, or a
tried identifier); and the assistant's prompt, response, and knowledge-doc content are excluded
entirely, honouring the hard constraint that Threads and Messages are private (ADR-0003,
CONTEXT.md) — only threadId, latency, token counts, and error class are logged. The standing rule
that keeps this alive: never pass a whole request, user, message, error, or row into a log call.
The redaction policy is security-sensitive (rule 5) and its implementing code carries human
review before merge.

## Continuous integration and testing (ADR-0012)

Every pull request and every push to main runs the quality gates on GitHub Actions, in one
workflow (.github/workflows/ci.yml) of four parallel, independent jobs: lint (biome ci),
typecheck across the workspaces, test-api (the integration suite), and a Playwright e2e lane. Each
reports its own status check. Runs use Node 22 and npm ci against the committed lockfile
(ADR-0010); a concurrency group keyed on the git ref cancels superseded in-flight runs, and npm
and the Playwright browser are cached, keeping metered minutes (a private repo) low. There is no
path-filtering yet — every job runs on every trigger — revisited only if minutes bite.

The test-api job keeps the Testcontainers harness rather than a services Postgres: the same code
path spins up an ephemeral Postgres 17 via the runner's own Docker daemon (ubuntu-latest ships
it), migrated fresh and driven in-process with app.inject(), identically to local runs. The e2e
lane is a real end-to-end pipe with stubbed content — Playwright builds and previews the SPA and
one smoke test asserts React mounts into #root — proving the lane so that later coverage is
writing tests, not standing up infrastructure. It stays non-required until real E2E coverage
exists.

Enforcement is advisory only: the checks run and show green or red on the PR but do not block
merge. Required status checks are Pro-gated on a Free personal account with a private repo (both
rulesets and classic branch protection return 403), so merge discipline is social until the plan
changes; the four check contexts are already recorded, so requiring them later is config-only with
no workflow edit. Deploy/CD automation remains unspecified (see Deferred to the build).

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

Secrets live in Render environment variables — DATABASE_URL, OPENROUTER_API_KEY (ADR-0013), the
Google Drive service-account key (GOOGLE_SERVICE_ACCOUNT_KEY, base64-encoded, alongside the
non-secret DRIVE_CORPUS_FOLDER_ID — provisioned out-of-band per
docs/features/assistant/provisioning-runbook.md), and later an email-provider key (ADR-0008,
Gmail SMTP). There is deliberately no auth
signing secret: the sessions are stateful and opaque, so nothing is signed (ADR-0006, reaffirmed by
ADR-0010); adding one to make sessions stateless would reverse ADR-0006, not add an env line. Local
development uses a gitignored .env with a committed .env.example; the SPA receives only the public
VITE_ API base URL. There is no dedicated secrets manager.

## Deferred to the build

- Native wrapping — v1 ships the browser SPA as an installable PWA; Capacitor native store builds
  (on-device token storage, deep links, push registration, app-store packaging) are a later
  build-time concern, taken up when native work starts.
- Realtime — the chatbot is synchronous, so it needs none. The task board updates live over
  server-sent events, not polling: a one-directional SSE channel whose fan-out filters every
  event per subscriber by the ADR-0007 scope predicate (ADR-0015). The board ships over REST
  first and goes live as its own build slice; the fan-out is security-sensitive under rule 5.
- CD — continuous integration now exists (ADR-0012: lint, typecheck, tests, and a stubbed e2e
  lane on every PR and push to main). The deploy pipeline that builds and pushes to the two Render
  services is not yet specified. Environment and secrets management itself is decided above.
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
- ADR-0010 — npm-workspaces monorepo and dockerized local dev environment; the concrete session
  window, auth schema, and env surface.
- ADR-0011 — backend logging with Pino: taxonomy, format, and the redaction and privacy policy.
- ADR-0012 — continuous integration on GitHub Actions: parallel lint/typecheck/test/e2e gates,
  Testcontainers in CI, advisory-only enforcement.
- ADR-0013 — the Assistant's LLM call goes through the OpenRouter broker (gemini-2.5-flash,
  env-pinned), not a first-party SDK; sets the answer budget and drops ANTHROPIC_API_KEY.
- ADR-0014 — the knowledge corpus is a free-plan shared folder synced by usage-driven resync
  (login + poll + manual), webhook deferred; ingests Docs/PDF/DOCX, scanned PDFs skipped.
