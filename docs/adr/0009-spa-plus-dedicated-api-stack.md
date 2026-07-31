# SPA plus a dedicated API stack, inheriting the Clix-CRM frontend and dropping its Next.js server layer

Status: accepted. This ADR records the architectural decision underneath the whole
engineering foundation: the shift from the source CRM's Next.js shape to a client-rendered
SPA talking to a dedicated Node API. It is the root cause of the mechanism-level changes
already recorded in ADR-0006 (auth) and ADR-0007 (permission enforcement); it does not
re-supersede them and does not edit them (rule 6). See "Relationship to prior ADRs" below.
It is the outcome of this map's chartering session plus the grilling on tickets #13 (API
framework) and #14 (hosting), whose rationale folds in here rather than into standalone ADRs.

## Context

The product and its data model are fixed in docs/prd.md; this decides how the app is built,
not what. The starting point is Clix-CRM, from which the product borrows exactly two
surfaces — the task board and the chatbot. Clix-CRM is a Next.js application: server-side
rendering, server actions for privileged writes, cookie-based SSR auth (Supabase Auth), and
Postgres row-level security as the enforcement plane.

Two forces pull against inheriting that whole shape. First, the target is a mobile-first app
that ships to native stores via Capacitor, and a Capacitor WebView loads the bundle from a
different origin than the API — cross-site cookies are blocked there, so cookie-SSR auth and
server actions do not carry across the surface we most need them on. Second, the product is a
thin two-feature app for a small client; full SSR and the framework machinery around it buy
little here. The chartering session took the client's steer to keep Clix-CRM's frontend
craft and drop its framework.

## Decision

Build a client-rendered single-page application against a separate, dedicated API server.

Inherit the frontend, not the framework. Keep Clix-CRM's React 19 components, Tailwind v4,
and shadcn/ui. Drop its Next.js SSR, server actions, and cookie-SSR auth server layer.

The SPA is Vite plus React 19 plus React Router, client-rendered. Server state is TanStack
Query; forms are react-hook-form with zod; internationalization is use-intl (next-intl's
framework-agnostic core), so Clix-CRM's message files and t() calls port near-verbatim and
the Hebrew/English RTL/LTR support is retained.

The backend is a dedicated Node API server running Fastify, over Postgres accessed through
Drizzle ORM. The SPA-to-API contract is plain typed fetch plus shared zod schemas, with zod
wired into Fastify via fastify-type-provider-zod; there is no framework-specific RPC client.
Clix-CRM's Drizzle tasks schema ports over, trimmed to the PRD. The assistant's direct
synchronous LLM call (ADR-0003) and the Google Drive knowledge-base sync (ADR-0004) live
inside this API server.

The server is persistent Node, not edge or serverless. This is fixed deliberately: the
synchronous LLM call (ADR-0003) must not sit under a platform wall-clock ceiling, and the
Drive sync (ADR-0004) runs as an in-process or worker cron, which a spin-down would break.

The repository is a pnpm-workspaces monorepo: apps/web (the SPA), apps/api (the Fastify
server), and packages/shared (the zod types used on both sides). Tooling is ported from
Clix-CRM: TypeScript, Biome, Vitest, Playwright, pnpm.

Native is Capacitor wrapping the static SPA bundle, Android first and then iOS, deferred past
v1. The v1 surface is the browser SPA installable as a PWA.

Hosting follows the same split, right-sized for a small delivery-first client and taking
vendor defaults. The API is a Render Web Service on persistent, paid, always-on Node — not a
free tier, whose spin-down would defeat the persistent-Node choice above. The SPA is a Render
Static Site on the free global CDN with SPA rewrites. The database is the existing Supabase
Pro Postgres used as plain Postgres via Drizzle over the session-pooler string with a small
server-side pool — Supabase for the managed Postgres, not for its Auth or PostgREST. The API
and database are co-located, EU/Frankfurt target, with the exact region pinned at
provisioning. Secrets live in Render environment variables; local development uses a
gitignored .env with a committed .env.example, and the SPA receives only the public API base
URL.

## Considered options

Keeping the whole Next.js stack was the alternative to the architecture itself. It was
rejected because the native shell erodes its foundations: a Capacitor WebView is cross-origin
to the API, so cookie-SSR auth and server actions do not reach the surface that most needs
them, and SSR earns little for a thin two-feature app. Inheriting the frontend while dropping
the framework keeps the craft that has value and sheds the machinery that does not.

Fastify versus Hono for the API framework (ticket #13). Persistent Node was fixed first, to
keep the synchronous LLM call off any wall-clock ceiling and let the Drive sync run in
process; that neutralized Hono's edge-portability edge. With portability off the table,
Fastify was chosen over Hono on maturity and battle-tested grounds, accepting the loss of
Hono's zod-plus-typed-client ergonomics (recovered via fastify-type-provider-zod and a plain
typed fetch contract). NestJS was ruled out as too heavy for this surface.

Edge or serverless hosting for the API was rejected for the same reason persistent Node was
chosen: spin-down would break the in-process Drive-sync cron and cold-start the synchronous
LLM call. Render's free tier was rejected for the same spin-down reason.

## Consequences

The split-origin SPA-to-API layout carries no penalty here, because transport is already a
bearer token plus CORS (ADR-0006) rather than a same-site cookie. The deployment cannot
commit to serving the SPA and API under one registrable domain, which is exactly why bearer
transport was chosen; the split is a fit, not a cost.

The one sticky, one-way-door choice is the database region pin. Moving a live Postgres to
another region is a dump-and-restore with downtime, whereas everything else is portable — the
SPA bundle is host-agnostic, Fastify runs anywhere, and Drizzle runs on standard Postgres.
The region is therefore chosen deliberately at provisioning and not treated as a casual
setting.

Relationship to prior ADRs. This stack shift is the architectural root beneath the changes
already recorded elsewhere. The auth mechanism it forced is ADR-0006 (owned module, stateful
DB-backed sessions, bearer transport), which supersedes ADR-0005's Supabase-Auth assumption.
The permission-enforcement mechanism it forced is ADR-0007 (role guards plus scope predicates
in the API layer), which supersedes the RLS-in-Postgres and Next-server-action assumptions of
ADR-0001, ADR-0002, and ADR-0003. Those supersessions are recorded forward, in the new ADRs;
this ADR names the shared cause and does not repeat or reopen them. The three-role model
(ADR-0001), the status-only employee write (ADR-0002), the synchronous chatbot (ADR-0003),
the Drive-synced knowledge base (ADR-0004), and the invite-only flow (ADR-0005) all stand in
intent — only their surrounding architecture moved.

The volatile specifics of this stack — package versions, the exact region, Render plan tiers,
the environment-variable list, the monorepo's concrete shape — live in docs/engineering-design.md,
the living record, not in this immutable ADR. Changing one of those edits the design note.
Only reversing a decision recorded here — leaving Render, abandoning the SPA split, moving off
Fastify — writes a new ADR that supersedes this one.
