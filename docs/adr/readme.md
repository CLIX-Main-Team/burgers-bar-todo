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
  corpus location and sync sequencing 0004 left open. Its trigger model (login + backstop + manual,
  changes-feed-only) is amended by 0021.
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
- 0020 — the UI icon system is Phosphor (@phosphor-icons/react, MIT), consumed as tree-shaken named
  imports and addressed by semantic role through a thin <Icon> wrapper over a role registry, never
  by bare glyph import. Two weights only (fill reserved for the active/selected state), named
  sm/md/lg sizes, currentColor→foreground, directional icons mirrored in RTL by one CSS rule. Beat
  Lucide (colour-only active signal) and Tabler on the regular→fill weight axis and brand fit.
  Covers UI glyphs only — the brand mark stays with ADR-0016. Spec: design-system/iconography.md.
  Numbered 0020 because 0018 (twice) and 0019 were already taken when this landed.
- 0021 — amends 0014: the knowledge base full-loads on the first ever sync (list the already-
  populated folder and ingest it, keyed on "no cursor yet"), then reconciles incrementally; the
  trigger model becomes a boot fire plus a fixed 20-minute interval (the login trigger is dropped —
  login no longer touches Drive); and folder scoping over Drive's account-wide changes feed moves
  into the real adapter. Stands up the deferred adapter (createGoogleDriveClient, google-auth-library
  JWT + fetch) and makes the two Drive credentials required at boot. Spec: #210.
- 0022 — amends 0018: adds a third Assistant provider preset, `groq` (Groq's OpenAI-compatible
  endpoint, default `llama-3.3-70b-versatile`), and moves the Render staging default from `gemini`
  to `groq`. Motivated by request headroom, not cost — both free tiers are zero-cost, but Gemini's
  Dec-2025-cut free tier (~10-15 RPM / 250-1,000 RPD) was rate-limiting the floor-shift Assistant,
  where Groq's free tier gives 30 RPM and far higher daily ceilings. Still one OpenAI-compatible
  `fetch`, no vendor SDK; `GROQ_API_KEY` joins the optional secret surface. From /wayfinder research
  on 2026 free-tier limits.
- 0023 — amends 0021: the knowledge corpus recurses into subfolders, delivering 0021's deferred
  recursion line. All still adapter-side (the sync port never learns about parents): listFiles
  walks the corpus folder tree breadth-first, listChanges scopes each change against the folder
  tree (rebuilt lazily, at most once per non-quiet page), and a folder-level change fans out to
  the files it silently carries — a folder dragged in upserts its documents, one dragged out or
  trashed removes them (listed trash-inclusive, since Drive marks a trashed folder's children
  trashed by inheritance). The adapter gains fetch-mocked unit tests, a step past 0021's
  probe-only posture now that scoping is real logic. Retires the root-copy workaround.
- 0024 — the admin Knowledge tab files docs by LLM, not by Drive folder: the corpus is a flat
  pile in practice, so a categorizer sweeps uncategorized rows after every sync pass (an
  afterReconcile hook inside the single-flight latch) and stamps one of seven fixed shelf slugs
  onto knowledge_docs.category. Transport failures stay NULL and self-heal next pass;
  unrecognizable replies floor to `general`; re-filing happens on rename only. The Drive port
  stays parents-free (0023's posture holds). Adds GET /assistant/knowledge (admin+manager) and
  finally registers the assistant routes in the running server, closing 0014's deferral.
- 0025 — supersedes 0004's retrieval mechanism: grounding moves from whole-doc keyword injection
  to chunked embedding retrieval, ranked in-process. The corpus outgrew the budget 4.9× and a
  probe battery measured the fallout (length-biased ranking, wrong-doc follow-ups, no
  cross-language reach, budget-filler noise). Docs chunk at ingestion (~450 tokens) into
  knowledge_chunks; chunks and queries embed via the provider's OpenAI-compatible /embeddings on
  the existing key (qwen3-embedding-8b @1024, chosen by a measured bilingual bake-off); ~90
  vectors rank by cosine in-process — pgvector is the 10×-corpus upgrade, deliberately not this
  slice. Two query variants keep follow-ups anchored; measured score gates ground NOTHING for
  small talk/off-topic; embeddings degrade to keyword-over-chunks, never to an error. The
  guardrail prompt gains persona, today's date + asker's role, answer-the-covered-part, and
  natural declines — #267's grounded-or-greeting policy unmoved. The live probe battery
  (assistant-probe.ts, `npm -w apps/api run probe`) becomes the committed answer-quality
  instrument. Three addenda from field measurement amend the selection rules (the ADR carries
  each one's evidence): the score gate is **gone** — the client's real questions and greeting
  noise overlap, so the guardrail decides instead; English chunks embed through a **Hebrew gist**
  so a Hebrew question can reach them; and ranking is now **hybrid**, an IDF-weighted keyword arm
  fused with the cosine one by Reciprocal Rank Fusion, for the answers that are written in the
  question's own words under a topic the embedding never associates with them.
- 0026 — the daily WhatsApp group digest is its own workspace and its own container, not a route in
  the API: it shares the repo and nothing else, has no inbound webhook, and is not connected to the
  staff app product-wise. One run scans every WhatsApp GROUP chat over the trailing 24 hours through
  Green API (plain fetch, no vendor SDK), writes ONE Hebrew summary through the same
  OpenAI-compatible provider switch ADR-0013, ADR-0018, and ADR-0022 settled, and sends it as ONE
  message to ONE number, on the Asia/Jerusalem wall clock. No database in v1: the job is stateless
  fetch, summarize, send, so a missed day stays missed and there is nothing to reconcile. Green API
  carries the instance token in the URL PATH, which makes any logged request URL a credential leak —
  so no URL is ever logged and every failure carries the method name and the status class only, the
  ADR-0011 rule facing a new way to break it. Gateway settings are READ in preflight and never
  written: setSettings reboots the instance for ~5 minutes, and the job would then fail its own
  journal reads. The recipient number is deliberately left BLANK, the dormant posture the push
  credentials already take (#59): the preflight, the scan, the transcript, and the Hebrew summary
  all run and are exercised in production, nothing is sent, and turning sending on is one value
  rather than a release. Two prerequisites are the owner's to clear rather than code's — the journal
  holds nothing until the instance is authorized by QR, so the first digest is legitimately empty
  and not broken, and the free Developer plan's cap of 3 chat correspondents a month makes a paid
  Business tier a precondition for a job whose whole premise is reading every group.
