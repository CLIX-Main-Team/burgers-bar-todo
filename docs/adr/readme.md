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
  The chat write mechanism it assumed is superseded by 0007.
- 0004 — the procedures/policies knowledge base lives in Google Drive, synced into a local cache.
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
