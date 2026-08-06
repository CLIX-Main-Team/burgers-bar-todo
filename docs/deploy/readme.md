# deploy — map and runbook

How the Burgers Bar staff app reaches **staging** — the environment this Blueprint provisions
(no separate production environment is modelled yet; ADR-0017 addendum). The decision behind it
is [ADR-0017](../adr/0017-render-deploy-blueprint-free-tier-ci-gated.md); this folder is the
operational companion — what to click once, which secrets to supply, and how a release flows
after that. The infrastructure itself is code: [`render.yaml`](../../render.yaml) (API) and
[`vercel.json`](../../vercel.json) (SPA) at the repo root.

**2026-08 platform move:** the app moved off the original developer's Render/Supabase accounts
onto the owner's own Render, Vercel, and Supabase accounts. The SPA moved from a Render static
site to Vercel; the API stayed on Render, on a fresh service (free-tier service names are
globally unique, so the URL below changed too). Both platforms deploy via their own API/CLI
rather than a magic deploy-hook URL — see `.github/workflows/deploy.yml`.

## The shape

One Render service, one Vercel project, one external database:

- **`burgers-bar-api`** (Render) — Docker web service (`apps/api/Dockerfile`), free tier,
  Frankfurt. Runs Fastify via `tsx`. Health at `/health`. Reached at
  `https://burgers-bar-api-tj29.onrender.com`.
- **`burgers-bar-todo`** (Vercel) — the built Vite SPA, static hosting. SPA-rewrites to
  `index.html` and carries the enforcing CSP as a response header (`vercel.json`). Reached at
  `https://burgers-bar-todo.vercel.app`. Vercel's own push-triggered builds are disabled
  (Ignore Build Step = `exit 0`) so the CI workflow stays the only deploy trigger.
- **Database** — the owner's own **Supabase** Postgres (Frankfurt). Not provisioned by Render
  or Vercel; reached over `DATABASE_URL`.

The API origin is pinned as a literal in both `render.yaml` (`CORS_ORIGIN`, `APP_BASE_URL`) and
`vercel.json` (CSP `connect-src`); the SPA origin is pinned as a literal in `render.yaml`'s
`CORS_ORIGIN`/`APP_BASE_URL` too, since the API needs to know where the SPA lives. **If either
service is renamed or moved to a custom domain, update those literals together**, plus the
`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/service-id literals in `deploy.yml`.

## One-time setup

### 1. Create the services

**Render (API):** the live service was created directly via the Render API (its GitHub App
needed a one-time authorization to see this org's repo — see `github.com/apps/render/installations/new`
if reconnecting on a fresh account), but `render.yaml` is the source of truth for its intended
config and is what a Blueprint re-sync would reconcile to. Supply the `sync: false` secrets
below via the service's Environment tab.

**Vercel (SPA):** the project is Git-linked to this repo (`vercel.json` at the repo root holds
the build command, output directory, SPA rewrite, and CSP/security headers) but with push
builds disabled — deploys only happen through the CI workflow below. On the free Hobby plan,
Vercel cannot import a **private** repo owned by a GitHub organization; this repo is public for
that reason (see the 2026-08 platform-migration decision for the tradeoff).

### 2. Supply the API secrets

| Key | What it is | Source |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **session-pooler** connection string. Must carry `sslmode=require` (Supabase's copy-paste string does). `pg` honours it; no SSL is hardcoded. If the chain ever fails to verify, `sslmode=no-verify` is the fallback. | Supabase dashboard → Connect → Session pooler |
| `ASSISTANT_PROVIDER` | Already a literal `openrouter` in `render.yaml` — the Assistant runs on OpenRouter, pinned to Gemini 3.6 Flash via `ASSISTANT_MODEL` (2026-08 owner decision). Not prompted; flip it in the file to switch to `gemini` or `groq`. | — |
| `OPENROUTER_API_KEY` | Assistant LLM key — **required** (OpenRouter is the live provider). | https://openrouter.ai/keys |
| `GEMINI_API_KEY` | Assistant LLM key, a declared alternate (ADR-0018). May be **left blank** while OpenRouter is live. | https://aistudio.google.com/apikey |
| `GROQ_API_KEY` | Assistant LLM broker key, a declared alternate (ADR-0022). May be **left blank** while OpenRouter is live. | https://console.groq.com/keys |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Drive sync service-account JSON, **base64** — **required** at boot (ADR-0014, ADR-0021) | `docs/features/assistant/provisioning-runbook.md` |
| `DRIVE_FOLDER_ID` | Shared knowledge-corpus folder id (not secret, but env-specific) — **required** at boot | same runbook |
| `SMTP_USER` / `SMTP_PASSWORD` | Gmail account + app password (ADR-0008) | Gmail |
| `MAIL_FROM` | From-header for transactional mail | your choice |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First-admin bootstrap — see step 4 | your choice |

Non-secret config (`NODE_ENV`, the SMTP host/port/secure, the origins) is already literal in
`render.yaml` and needs no input.

### 3. Wire the CI deploy path

The release pipeline (`.github/workflows/deploy.yml`) migrates the database, then triggers the
API and SPA via each platform's own API — no deploy-hook URL to copy. Create these
**GitHub Actions repository secrets**:

| Secret | How to get it |
| --- | --- |
| `DATABASE_URL` | Same Supabase session-pooler string as above — the migrate job connects with it. |
| `RENDER_API_KEY` | Render → Account Settings → API Keys → Create API Key |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens → Create |

The Render service id and Vercel org/project ids are plain (non-secret) literals already in
`deploy.yml` — update them together if either service is ever recreated.

Because the Render service sets `autoDeploy: false` and the Vercel project has push builds
disabled, neither platform deploys on push on its own — the CI job is the only trigger, which is
what keeps schema and code in lockstep.

### 4. Seed the first admin (once)

The first admin is bootstrapped by hand so `SEED_ADMIN_PASSWORD` never becomes a standing secret.
From a trusted machine, against the **staging** database (whatever `DATABASE_URL` points at):

```bash
export DATABASE_URL='<supabase session-pooler string, with sslmode=require>'
export SEED_ADMIN_EMAIL='admin@<your-domain>'
export SEED_ADMIN_PASSWORD='<a strong one-time password>'

npm ci
npm run db:migrate --workspace @burgers/api   # apply schema (idempotent)
npm run seed        --workspace @burgers/api   # create the first admin (idempotent)
```

Then log in and change the password through the app. After this, invites flow from within the app
(ADR-0005); you never run `seed` again.

## The ongoing release flow

1. Merge to `main`.
2. **CI** runs (ADR-0012: lint, typecheck, tests, e2e). Advisory, but the deploy waits on it.
3. On CI success, **Deploy** runs: applies any new Drizzle migrations to the database, then — only if they
   succeed — triggers a Render deploy via its API, then a Vercel production deploy via its CLI. A
   broken migration fails the job and nothing ships (the free-tier substitute for
   `preDeployCommand`).
4. Render rebuilds the API; Vercel rebuilds and rolls over the SPA.

Manual re-deploy without a code change: run the **Deploy** workflow via `workflow_dispatch`.

## Free-tier caveats (ADR-0017)

- The API **spins down when idle** and cold-starts on the next request — first use after a quiet
  stretch is slow.
- The Assistant's **unattended Drive backstop poll does not run** while the service is asleep;
  login-triggered and manual resync still work because a request wakes it.
- Free services share a **monthly instance-hours cap** — fine for one API, a ceiling to remember
  before adding more.
- The future live board (ADR-0015) will meet the same spin-down; weigh it when that slice lands.
