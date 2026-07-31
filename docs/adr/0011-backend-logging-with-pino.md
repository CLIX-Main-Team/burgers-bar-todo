# Backend logging with Pino: taxonomy, format, and a redaction policy

Status: accepted. This is the first observability decision in the repo. It sits under
ADR-0009's stack (a dedicated Fastify API) and does not touch the auth mechanism (ADR-0006),
the enforcement model (ADR-0007), the chatbot LLM call (ADR-0003), the Drive sync (ADR-0004),
or the mail transport (ADR-0008); it references those decisions to fix what their code logs,
and notes the ripple forward without editing them (rule 6). The redaction and privacy policy
below is security-sensitive under rule 5 and carries the human-review gate before merge; this
ADR is the policy, not yet the code that implements it, which carries the gate again when it
lands. It arose from two grilling sessions on map #21 (backend logging approach): the taxonomy
and format in #22, the redaction and privacy policy in #23.

## Context

The API is a persistent Fastify service on Node (ADR-0009), and Fastify ships Pino as its
built-in logger. The stack already commits us to Pino; it covers structured logs, custom
serializers, and field redaction, and evaluating an alternative would be gold-plating at this
scale (small client, delivery-first). So the library is a settled fact, not a decision this
ADR reopens. What was undecided, and what the first line of server code needs settled before it
can log consistently, is three things: the logging taxonomy (levels, correlation, a named
event catalogue), the output format across dev and prod, and — the security-sensitive part — a
redaction and privacy policy that keeps secrets and private content out of the log stream.

The privacy constraint is hard and domain-specific. CONTEXT.md makes Threads and Messages
private, visible to no one, not even admins, so the Assistant's LLM prompt and response content
must never appear in a log line. Passwords, session bearer tokens, and invite and reset tokens
must never be logged either. A logging approach for this app is a privacy decision first and a
diagnostics convenience second.

## Decision

### Library and destination

Pino, Fastify's built-in logger, is used as-is; no alternative was evaluated (right-sizing).
The log destination is the vendor default: the API writes to stdout and Render captures it
(ADR-0009 hosting). There is no log drain, no retention schedule, and no alerting or dashboard
programme — those are deferred and, at this scale, likely never needed.

### Spine: automatic request logging, customized

Fastify's per-request logging stays on as the backbone. Each request gets an arrival line and a
response line carrying the auto-generated `reqId`. Domain-event lines are layered on top through
child loggers that inherit the `reqId`. The req and res serializers are customized to strip
headers and bodies (the redaction section below), but the auto-logging model itself is kept, not
disabled and not hand-rolled. Anything not given a named event still produces a `reqId`-tagged
req/res line, so the system is never silent — just not hand-naming low-value events.

### Correlation

- `reqId` — Fastify's per-request id, covering all request-bound work.
- `runId` — minted once per Drive-sync run (ADR-0004), carried on the worker's child logger
  alongside `trigger`, one of push, poll, or manual. It is independent of any request. On a
  manual resync the triggering request's `reqId` is also logged, so the human action ties back
  to its run.
- `component` — a string tag on every domain child logger: auth, assistant, drive-sync, authz,
  or system.

The synchronous LLM call (ADR-0003) is request-bound, so it logs through
`request.log.child({ component: 'assistant', threadId })` — it gets the `reqId` for free and
introduces no new correlation primitive. This closes the "correlation across the LLM call and
the Drive-sync worker" question map #21 held under Not yet specified.

### Levels

Five levels; Pino's `trace` is dropped.

- `fatal` — the process cannot continue and is about to exit (no DB at boot, a missing secret).
- `error` — a request or job failed but the server keeps running (an unhandled 5xx, an LLM
  error, a failed sync run). An error class, never a raw stack carrying secrets.
- `warn` — recoverable but notable: a permission denial (ADR-0007), a reset rate-limit trip, a
  Drive channel nearing expiry, a poll finding the cache stale.
- `info` — normal business: the req/res auto-lines, auth lifecycle, LLM call start and outcome,
  sync run start and summary, server lifecycle.
- `debug` — developer diagnostics, off in prod: branch traces, query shape, retries, cache
  hit/miss.

Production runs at `info`, development at `debug`. Permission denials log at `warn` — expected
and security-relevant, not an error. Successful login and logout log at `info` and stay on in
prod as an audit-ish trail.

### Event catalogue

Every domain line carries a stable `event` string and a `component`, so logs are queried by
those fields rather than by grepping message text. `reqId` and `runId` are inherited; the fields
listed are the additional structured ones.

Auth (`component: 'auth'`, ADR-0006):

- `login` and `logout` — info — userId, role, locationId, outcome.
- `login_failed` — warn — reason class (for example bad_credentials); non-enumerating, never the
  tried identifier.
- `invite_accepted` — info — userId, role, locationId.
- `password_reset_requested` and `password_reset_completed` — info — userId on completion; the
  request line stays non-enumerating (no user-found signal).
- `user_deactivated` — info — userId (target), actorUserId.

Assistant (`component: 'assistant'`, ADR-0003):

- `assistant_call_start` — info — threadId.
- `assistant_call_complete` — info — threadId, latencyMs, tokensIn and tokensOut and cost when
  the provider returns them, docsGrounded (a count).
- `assistant_call_error` — error — threadId, errorClass, latencyMs.
- Prompt, response, and knowledge-doc content are excluded entirely (see redaction).

Drive-sync (`component: 'drive-sync'`, ADR-0004):

- `sync_start` — info — runId, trigger.
- `sync_complete` — info — runId, docsSynced, docsFailed, durationMs.
- `sync_error` — error — runId, errorClass.
- `channel_expiring` — warn — channel id, expiry.

Permission (`component: 'authz'`, ADR-0007):

- `permission_denied` — warn — userId, role, the route or action attempted, denial reason.

Errors: `unhandled_error` — error — errorClass, route. Wired through Fastify's `setErrorHandler`
so every 5xx yields exactly one line rather than being double-logged with the auto response line.

System (`component: 'system'`): `server_started` and `server_stopping` — info — the normal
pairing with the fatal-at-boot case.

### Output format and configuration

- Development: `pino-pretty`, a dev-only transport, at level `debug`.
- Production: newline-delimited JSON to stdout, no transport, at level `info`. Render captures
  stdout.
- Configuration: `LOG_LEVEL` (default `info`) sets the level; an env signal (NODE_ENV or
  LOG_PRETTY) selects pretty versus JSON. `pino-pretty` is a devDependency only and never enters
  the production image.
- Base fields: Pino's defaults (level, time, pid, hostname) plus a `service` field
  (`burgers-bar-api`). Timestamps are ISO-8601 for readability.

### Ownership and access

Fastify owns a single root logger, configured once at app build in `Fastify({ logger: ... })` —
the one place the level, format, serializers, and redaction options live.

- Request-bound code uses `request.log` (the auto per-request child, carrying `reqId`); domain
  events add `component` and `event` through `request.log.child(...)`.
- The Drive-sync worker uses `app.log.child({ component: 'drive-sync', runId, trigger })` and is
  handed the app or logger at construction — there is no global singleton.
- There is no standalone `logger.ts` that calls `pino()` itself. A second logger would duplicate
  config and, worse, bypass the redaction options below. Services take the logger, or the app, as
  a dependency rather than importing a global.

### Redaction and privacy policy (security-sensitive, rule 5)

The governing model is allow-list primary: safety comes from the pipeline only ever emitting an
explicitly chosen set of fields. Pino's `redact` is a defense-in-depth backstop that catches
what a mis-shaped serializer or a careless future log call might slip through — it is never the
first line of defense.

Custom request serializer, safe set only. Emits `method`, `routeName` (the route pattern),
`path` (the raw path with the query string stripped), `reqId`, and the allow-listed individual
headers `user-agent` and `content-length`. No `headers` object, no query string, no `referer` —
the query string is the carrier for password-reset and invite-accept tokens, so it never reaches
a log line.

Custom response serializer. Emits `statusCode` and `responseTime` only. No response headers, no
`set-cookie`.

Custom error serializer, safe set only. Emits `type` (surfaced as `errorClass`), `message`,
`stack`, and a numeric HTTP `statusCode` when present. No other error property is spread. This
blocks two subtle re-leak paths: provider-SDK errors that embed the request payload (the prompt)
or the response body, and DB errors whose message, parameters, or detail carry row values (a
password hash, a token, an email). `assistant_call_error` therefore reduces to errorClass,
latencyMs, and threadId.

PII, id-only, always. Users, locations, and actors are referenced by id (`userId`, `locationId`,
`actorUserId`). Email, display name, and the raw submitted identifier on an auth failure are
never logged. `role` and preferred language are non-identifying and fine to log. An operator who
needs the human behind a `userId` looks it up in the DB; the log stays PII-free, and
`login_failed` is never a credential-stuffing artifact.

Assistant content, excluded entirely. Prompt, response, and knowledge-doc content are never
logged — the hard domain constraint that Threads and Messages are private. Only safe metadata is
logged: threadId (an opaque correlation key, not content), latencyMs, token counts, the
docsGrounded count, and errorClass. Logging the fact, latency, and outcome of a call is
legitimate ops; its content is not.

The `redact` backstop censors to the string `"[Redacted]"`, preserving the key so a
present-but-scrubbed field is distinguishable from an absent one: the headers
`req.headers.authorization`, `req.headers.cookie`, and `res.headers['set-cookie']`, and the
field paths `password`, `passwordHash`, `token`, `email`, `displayName`, plus the DB driver's
known payload-bearing fields. This is a backstop, not permission to be careless.

Standing rule for all future logging code. Never pass a whole `request`, `user`, `message`,
`error`, or DB row object into a log call. Log an explicit set of ids and scalars. The custom
serializers and the `redact` list are a safety net, not the primary control — this rule is what
keeps the policy alive after we stop looking at it. The serializers and `redact` live in the
single Fastify-owned root logger config, so there is no second logger that could bypass them.

## Considered options

`trace` as a sixth level was dropped: five levels cover the app's needs and `debug` already
carries developer diagnostics, so a sixth would only invite inconsistent use.

A standalone logger module (`logger.ts` calling `pino()` directly) was rejected in favour of the
Fastify-owned root logger. A second logger would duplicate the level and format config and, more
seriously, bypass the serializers and `redact` that enforce the privacy policy — the exact
failure the single-source-of-truth ownership prevents.

A denylist-primary redaction model — log broadly and scrub known-bad fields — was rejected in
favour of allow-list primary. A denylist fails open: a new field carrying a secret is logged
until someone notices and adds it to the list. The allow-list fails closed, emitting only fields
chosen on purpose, with `redact` as the backstop rather than the mechanism.

A log drain, retention schedule, and alerting or dashboard programme were considered and
deferred. Render's stdout capture is the vendor default and sufficient at this scale; building an
observability programme around a small delivery-first client would be gold-plating (right-sizing
under the operating standard). This is revisited only if a concrete operational need appears.

## Consequences

The first line of API code can log consistently: a named event with a component, an inherited
correlation id, and an explicit set of safe fields. Logs are queried by `event` and `component`
rather than by grepping messages, and the req/res spine means nothing is silent.

The privacy policy holds only as long as the standing rule is followed. The serializers and
`redact` are a backstop; the real guarantee is that log calls pass ids and scalars, never whole
objects. Every future service that logs inherits this rule, and any change to the serializers or
`redact` config is a change to a security control — it carries the rule-5 human-review gate, as
this ADR does.

Doc ripple. This ADR is referenced from the Engineering Design's new logging section and from
the ADR index. It notes forward, without editing, its relationship to ADR-0003 (the assistant
call whose content is excluded), ADR-0004 (the Drive-sync worker's runId correlation and the
Render stdout capture), ADR-0006 (the auth events and the tokens that must never be logged), and
ADR-0007 (permission denials logged at warn) — those records stand unchanged (rule 6). CONTEXT.md
is untouched: this ADR introduces no new domain vocabulary; it enforces the existing privacy of
Threads and Messages. Wiring Pino into the app is the Feature Delivery Loop that follows this
decision, not part of it, and it carries the rule-5 gate again when the redaction code lands.
