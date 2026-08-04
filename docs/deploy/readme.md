# deploy — map and runbook

How the Burgers Bar staff app reaches **staging** — the environment this Blueprint provisions
(no separate production environment is modelled yet; ADR-0017 addendum). The decision behind it
is [ADR-0017](../adr/0017-render-deploy-blueprint-free-tier-ci-gated.md); this folder is the
operational companion — what to click once, which secrets to supply, and how a release flows
after that. The infrastructure itself is code: [`render.yaml`](../../render.yaml) at the repo root.

## The shape

Two Render services, one external database:

- **`burgers-bar-api`** — Docker web service (`apps/api/Dockerfile`), free tier, Frankfurt. Runs
  Fastify via `tsx`. Health at `/health`. Reached at `https://burgers-bar-api.onrender.com`.
- **`burgers-bar-todo`** — static site (the built Vite SPA), free CDN. SPA-rewrites to
  `index.html` and carries the enforcing CSP as a response header. Reached at
  `https://burgers-bar-todo.onrender.com`.
- **Database** — the existing external **Supabase** Postgres. Not provisioned by Render; reached
  over `DATABASE_URL`.

The two onrender origins are pinned as literals in `render.yaml` (CORS, the invite/reset link
base, `VITE_API_BASE_URL`, and the CSP `connect-src`). **If you rename a service, update those
literals together.**

## One-time setup

### 1. Create the Blueprint

In Render: **New → Blueprint**, point it at this repo. Render reads `render.yaml` and creates both
services. On first sync it prompts for every `sync: false` secret — supply the values from the
table below. Nothing secret is committed; the Blueprint declares only key names.

### 2. Supply the API secrets

| Key | What it is | Source |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **session-pooler** connection string. Must carry `sslmode=require` (Supabase's copy-paste string does). `pg` honours it; no SSL is hardcoded. If the chain ever fails to verify, `sslmode=no-verify` is the fallback. | Supabase dashboard → Connect → Session pooler |
| `ASSISTANT_PROVIDER` | Already a literal `groq` in `render.yaml` — the Assistant runs on Groq here (ADR-0022), whose free tier has more request headroom than Gemini's. Not prompted; flip it in the file to switch to `gemini` or `openrouter`. | — |
| `GROQ_API_KEY` | Assistant LLM key — **required** (Groq is the live provider). Free tier, no card. | https://console.groq.com/keys |
| `GEMINI_API_KEY` | Assistant LLM key, a declared alternate (ADR-0018). May be **left blank** while Groq is live. | https://aistudio.google.com/apikey |
| `OPENROUTER_API_KEY` | Assistant LLM broker key, a declared alternate (ADR-0013). May be **left blank** while Groq is live. | OpenRouter |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Drive sync service-account JSON, **base64** — **required** at boot (ADR-0014, ADR-0021) | `docs/features/assistant/provisioning-runbook.md` |
| `DRIVE_FOLDER_ID` | Shared knowledge-corpus folder id (not secret, but env-specific) — **required** at boot | same runbook |
| `SMTP_USER` / `SMTP_PASSWORD` | Gmail account + app password (ADR-0008) | Gmail |
| `MAIL_FROM` | From-header for transactional mail | your choice |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | First-admin bootstrap — see step 4 | your choice |

Non-secret config (`NODE_ENV`, the SMTP host/port/secure, the origins) is already literal in
`render.yaml` and needs no input.

### 3. Wire the CI deploy path

The release pipeline (`.github/workflows/deploy.yml`) migrates the staging database, then triggers the services.
Create these **GitHub Actions repository secrets**:

| Secret | How to get it |
| --- | --- |
| `DATABASE_URL` | Same Supabase session-pooler string as above — the migrate job connects with it. |
| `RENDER_DEPLOY_HOOK_API` | `burgers-bar-api` → Settings → Deploy Hook → copy URL |
| `RENDER_DEPLOY_HOOK_WEB` | `burgers-bar-todo` → Settings → Deploy Hook → copy URL |

Because both services set `autoDeploy: false`, Render will not deploy on push on its own — the CI
job is the only trigger, which is what keeps schema and code in lockstep.

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
3. On CI success, **Deploy** runs: applies any new Drizzle migrations to the staging database, then — only if they
   succeed — fires the API deploy hook, then the SPA deploy hook. A broken migration fails the job
   and nothing ships (the free-tier substitute for `preDeployCommand`).
4. Render rebuilds and rolls over each service.

Manual re-deploy without a code change: run the **Deploy** workflow via `workflow_dispatch`.

## Free-tier caveats (ADR-0017)

- The API **spins down when idle** and cold-starts on the next request — first use after a quiet
  stretch is slow.
- The Assistant's **unattended Drive backstop poll does not run** while the service is asleep;
  login-triggered and manual resync still work because a request wakes it.
- Free services share a **monthly instance-hours cap** — fine for one API, a ceiling to remember
  before adding more.
- The future live board (ADR-0015) will meet the same spin-down; weigh it when that slice lands.
