# deploy: map and runbook

How the Burgers Bar staff app reaches production: one Hostinger VPS, three containers behind
Traefik, and the Supabase Postgres database. The decision behind the pipeline is
[ADR-0017](../adr/0017-render-deploy-blueprint-free-tier-ci-gated.md), written for Render and
repointed in 2026-08 to the VPS; this folder is the operational companion. The owner's version of
the same material is section 6 of `START-HERE.md` at the repo root.

## The shape

- **Server**: `srv1928986.hstgr.cloud` (Hostinger VPS, Docker, SSH key-only as `root`). The app
  answers at `https://burgers.srv1928986.hstgr.cloud` (the SPA) and `/api` (the API).
- **Containers** (`docker-compose.prod.yml`): `burgers-bar-api-1` (Fastify, `apps/api/Dockerfile`),
  `burgers-bar-web-1` (nginx serving the built SPA, `apps/web/Dockerfile`, with the security
  headers in `apps/web/nginx-headers.conf`) and `burgers-bar-whatsapp-digest-1` (the daily digest).
  None publishes a port.
- **Traefik**, configured at `/docker/traefik` on the box, outside this repo, terminates TLS with
  Let's Encrypt and routes `DEPLOY_HOST` to the SPA and `DEPLOY_HOST/api` to the API (stripping
  `/api`).
- **Database**: Supabase Postgres (Frankfurt), reached over `DATABASE_URL`. Not on the server.

## Files on the server

Everything lives in `/docker/burgers-bar`:

- `.env.prod`, the **master env file** (template: `.env.prod.example`). Hand-maintained, never in
  git. Every production secret and setting is a line here.
- `src/`, the deployed code. `src/.env.prod` is a copy of the master file made on every deploy, so
  an edit there vanishes with the next merge. Edit the master file only.
- `src/DEPLOYED_SHA`, the short commit id of what is running.
- `src.prev/`, the previous tree, kept for reference. It is not a rollback button.

## GitHub secrets

| Secret | What it is |
| --- | --- |
| `DATABASE_URL` | The Supabase session-pooler string (it carries `sslmode=require`). The migrate step connects with it. |
| `VPS_SSH_KEY` | The private half of the deploy key whose public half sits in `/root/.ssh/authorized_keys` on the server. |

The server's host key is pinned in `.github/workflows/deploy.yml`; it changes only if the server
is rebuilt.

## The release flow

1. Merge to `main`.
2. **CI** (`ci.yml`, ADR-0012) runs lint, typecheck, API tests, digest tests and browser tests.
   The checks are advisory until a branch rule requires them, but the deploy waits on them.
3. On CI success, **Deploy** (`deploy.yml`) applies any new Drizzle migrations to the production
   database, and only then runs `scripts/deploy-vps.sh`: git-archives `HEAD` to the server, copies
   the master env file into `src/`, builds the three images on the box, swaps the containers and
   waits up to two minutes for the API health check. A broken migration fails the job and nothing
   ships. A red CI means no deploy, shown as a grey "skipped" run, not a red cross.
4. Deploy can be run by hand from the Actions tab (Deploy, Run workflow). That is also how the
   server picks up an edited master env file.

After every deploy: the run is green, `https://burgers.srv1928986.hstgr.cloud/api/health` answers
ok, `docker logs burgers-bar-whatsapp-digest-1` shows no crash loop (that container has no health
check), and `src/DEPLOYED_SHA` matches the merged commit.

## Hand deploy and rollback

`./scripts/deploy-vps.sh` from the repo root in Git Bash, with the private key at
`~/.ssh/burgers_vps` (or `VPS_SSH_KEY=<path>` in `.env`), ships the committed `HEAD` without
running migrations. It is for when GitHub Actions is down, never for a change that carries a
migration.

There is no rollback command. Revert the change on `main` and let Deploy run, or run the script
with the older commit checked out. Neither undoes a migration.

## Two traps

1. Never run `docker compose up` by hand inside `src` without `--env-file .env.prod`:
   `DEPLOY_HOST` is then empty, Traefik's routes break and the site drops.
2. Edit only the master `/docker/burgers-bar/.env.prod`, then run Deploy so the containers pick
   it up.

## The first admin

Production is already seeded. If a new owner login is ever needed and no super admin exists to
invite one, run the seed once from a trusted machine against the production database, with the
three values set in the shell for that one command (never in a file):

```bash
DATABASE_URL='<supabase session-pooler string>' SEED_ADMIN_EMAIL='<you>' SEED_ADMIN_PASSWORD='<private>' npm run seed
```

It adds a super admin and leaves existing rows alone. Then sign in and change the password through
the app.
