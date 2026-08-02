# Burgers Bar staff app

A staff-facing app for the Burgers Bar restaurant chain: a shared task board and an AI
ops-assistant chatbot, used by staff across multiple restaurant locations. The domain
vocabulary is in CONTEXT.md; the product requirements are in docs/prd.md; how the app is
built is in docs/engineering-design.md. This file is the developer front door — how to run
it locally.

## Layout

An npm-workspaces monorepo (ADR-0010) with three packages:

- apps/web — the SPA. Vite and React, client-rendered, on its own dev origin.
- apps/api — the API server. Fastify on Node, over Postgres through Drizzle ORM. Holds the
  auth module and, later, the enforcement layer, the assistant service, and the Drive-sync job.
- packages/shared — the zod schemas shared by both sides. The API wires them in via
  fastify-type-provider-zod; the SPA validates against the same source.

## Prerequisites

Node 22 or newer, and Docker with Compose. Local infrastructure (Postgres and mailpit) runs in
Docker; the API and web run on the host across split origins, so CORS and the bearer path are
exercised in development the way they run in production.

## Running it

The Makefile is the front door. From a fresh clone:

- make setup — install dependencies, start infrastructure, apply migrations, seed. Takes a
  fresh clone to a running, migratable system. On first run it creates .env from .env.example
  and apps/web/.env.local from apps/web/.env.example; review the .env values.
- make dev — run the API and web dev servers together (API on 3000, web on 5173).
- make up / make down — start or stop infrastructure only; the database volume is kept on down.
- make reset — clean-slate database: drop the volume, bring infrastructure back, migrate, seed.
  This is how you get back to fresh state (invited, active, deactivated users; fresh and consumed
  tokens) while testing.
- make migrate — apply the committed migrations. make generate — generate a new migration from
  the Drizzle schema (versioned SQL, committed and reviewed; never drizzle-kit push).
- make seed — seed the first admin (idempotent). make logs — tail infrastructure logs.

Run make with no target to list them all.

## Configuration

A single gitignored root .env, copied from the committed .env.example, is the one source consumed
by Docker Compose, the API, and the migrate and seed scripts. apps/web reads only VITE_API_BASE_URL
from apps/web/.env.local, so no server secret can be exposed into the client bundle. Mail in
development is caught by mailpit (SMTP on 1025, web UI at http://localhost:8025); nothing leaves
the machine.

## Testing

The API integration suite runs against a real, ephemeral Postgres spun up per run via
Testcontainers and migrated fresh, driving the Fastify app in-process with app.inject() — no
network, no mocked database. Run it with npm test (or npm -w apps/api test). Docker must be
running.

## CI

Every pull request and every push to main runs the quality gates on GitHub Actions
(.github/workflows/ci.yml, ADR-0012): four parallel jobs — lint (biome ci), typecheck across the
workspaces, test-api (the Testcontainers integration suite, using the runner's own Docker daemon),
and a Playwright e2e smoke test that builds and previews the SPA. Each shows its own green-or-red
check on the PR. The checks are advisory today — they report but do not block merge — so a red
check means fix it before merging even though the button is not disabled. Run the same gates
locally before pushing: npm run typecheck, npx biome ci ., and npm test.
