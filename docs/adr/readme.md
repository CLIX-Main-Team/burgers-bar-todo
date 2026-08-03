# adr — architecture decision records

The decisions behind the product and the build, each record carrying the choice and why it was
made. ADRs are immutable (rule 6): a decision is never edited once recorded; it is superseded by a
new ADR, and the supersession is noted forward in the new record. Read the record before assuming
how something works — the rationale is in it.

Records:

- 0001 — three-role model (admin, manager, employee) and the authority split between them. The
  enforcement mechanism it assumed (Postgres RLS) is superseded by 0007.
- 0002 — employees may change only a task's status. The mechanism it assumed (a Next server
  action) is superseded by 0007.
- 0003 — the chatbot answers via a direct, synchronous in-app LLM call, no webhook or callback.
  The chat write mechanism it assumed is superseded by 0007; the provider/SDK it left open is
  fixed by 0013.
- 0004 — the procedures/policies knowledge base lives in Google Drive, synced into a local cache.
  The corpus location and sync-trigger sequencing it left open are fixed by 0014.
- 0005 — invite-only provisioning with a seeded first admin and invite-encoded role/location. The
  auth mechanism it assumed (Supabase Auth) is superseded by 0006.
- 0006 — owned auth module with stateful DB-backed sessions and bearer-everywhere transport.
  Supersedes 0005's auth mechanism.
- 0007 — permission enforcement in the API layer: role guards plus mandatory scope predicates.
  Supersedes the enforcement mechanisms of 0001, 0002, and 0003.
- 0008 — Gmail SMTP for transactional email (invites, password resets).
- 0009 — the SPA plus dedicated-API stack: inherit the Clix-CRM frontend, drop its Next.js server
  layer. The architectural root beneath 0006 and 0007; folds in the API-framework (Fastify) and
  hosting decisions.
- 0010 — npm-workspaces monorepo and a dockerized local dev environment mirroring prod. The first
  build-tooling decision: reverses the pnpm lean to npm workspaces, stands up docker Postgres and
  mailpit for local dev, and fixes the concrete session window (SESSION_TTL_DAYS=14), the auth
  three-table schema, and the env surface (with deliberately no signing secret).
- 0011 — backend logging with Pino: the taxonomy (five levels, reqId/runId correlation, a named
  event catalogue), the output format (pino-pretty in dev, NDJSON on stdout in prod), and a
  security-sensitive redaction and privacy policy (allow-list primary, assistant content and
  secrets never logged). The first observability decision.
- 0012 — continuous integration on GitHub Actions: four parallel jobs (lint, typecheck, test-api
  on Testcontainers Postgres, a stubbed Playwright e2e lane) on pull requests and pushes to main,
  with concurrency-cancellation and npm/Playwright caching. Enforcement (required checks) is
  advisory-only — Pro-gated on this private Free repo — which corrects the enforcement finding of
  the #41 platform research. The first continuous-integration decision.
- 0013 — the Assistant's synchronous LLM call goes through the OpenRouter broker (plain fetch,
  gemini-2.5-flash env-pinned) rather than the first-party Anthropic SDK the engineering design had
  assumed; fixes the provider/SDK and answer budget 0003 left open, and drops ANTHROPIC_API_KEY for
  OPENROUTER_API_KEY.
- 0014 — the knowledge corpus is a free-plan folder shared to the sync service account (not a
  Shared Drive), synced by usage-driven resync (login + backstop poll + manual), with the Drive
  webhook deferred; ingests Google Docs, text PDFs, and DOCX, skipping scanned PDFs. Fixes the
  corpus location and sync sequencing 0004 left open.
- 0015 — the task board updates live over server-sent events, not polling: a one-directional
  SSE channel whose fan-out filters every event per subscriber by the same ADR-0007 scope
  predicate that gates reads, so realtime cannot leak a task outside a viewer's scope. Reverses
  the engineering design's lean toward polling; security-sensitive fan-out under rule 5. The
  board ships over REST first, then goes live as its own build slice.
- 0018 — the pre-auth frame is a sanctioned exception to principle #6 (retheme, don't redesign):
  the shared AuthLayout (login, accept-invite, and the two reset screens) may be redesigned into a
  desktop 50/50 split with a gold brand panel composed from the #107 assets per ADR-0016 — bracket
  embrace, no-card form, the tagline "Your shift starts here.", mobile brand cap. The exception is
  the frame only; the forms inside and every authenticated surface stay pure retheme. Records the
  design signed off in map #116 (research #117, prototype #118); a separate /implement builds it.
- 0016 — brand identity is composed from the client's existing mark, not redrawn: the build
  recolours and composes the mark and wordmark (#66) into the app/PWA icon, favicon, header
  lockups, and assistant mark in-token, but never redraws the corporate letterform (a client
  decision). Resolves the deferred visual-design pass into build work (icon-asset umbrella #103,
  narrowing #100's out-of-scope) with empty-state illustration deferred as type-only for v1.
- 0017 — deploy on Render from a committed render.yaml Blueprint, on the free tier, with the
  deploy/CD pipeline ADR-0009 deferred: the API a Docker web service running tsx in-image, the
  SPA a static site that is the CSP-header enforcement point, and migrations gated in CI (apply
  to prod, then fire the Deploy Hooks — the free-tier substitute for preDeployCommand). Records
  the free-tier trade-off (spin-down, and the unattended Drive backstop degrading) without
  reversing ADR-0009's Render/SPA/Fastify decisions; the tier value moves in engineering-design.md.
- 0019 — the Playwright e2e lane gains a live backbone: the real `server.ts` API and a seeded
  Postgres behind the browser, loaded with a test-only fixture cast (three roles × three statuses
  × two Locations, built through real provisioning code by a single `loadFixtureCast` seam, never
  the ADR-0005 seed). Fulfils ADR-0012's stubbed Playwright lane with real coverage of the
  provisioning surface: real sessions (ADR-0006), real list scope (ADR-0007), real invite
  lifecycle. Read-only baseline plus own-your-mutations keeps `fullyParallel` on a single DB;
  CI provisions Postgres/mailpit as service containers — a deliberate divergence from ADR-0012's
  Testcontainers `test-api` (which stands unchanged), because a long-running server needs a fixed
  URL. Booted with a dummy LLM key (ADR-0018) and SMTP to mailpit (ADR-0008); stubs kept only for
  conditions a real backend can't produce. Specified in #151.
