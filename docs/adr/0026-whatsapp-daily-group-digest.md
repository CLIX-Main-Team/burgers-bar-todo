# The daily WhatsApp group digest is a standalone workspace with its own container

Status: accepted. Decided when the owner asked for one thing: read every WhatsApp **group** chat
the business account sits in, once a day, and send him a single Hebrew summary of that day to one
phone number. Records the shape that ask takes here — a new npm workspace
(`@burgers/whatsapp-digest`), a third production container, Green API over plain `fetch`, no
database, and a recipient deliberately left blank so the whole job ships exercised before it can
message anybody. Numbered 0026 because 0025 is the highest record and 0018 is already used twice
in this folder.

## Context

The staff app's Assistant (ADR-0003, ADR-0013, ADR-0025) reads a Drive corpus and answers
questions inside the product. This is not that. The digest has no user, no screen, and no request
to serve: it wakes once a day, reads the last 24 hours of group traffic through a gateway, asks a
model for one summary, sends that summary to one number, and goes back to sleep. It is not a
chatbot, it has no inbound webhook, and nothing in the staff app links to it. It shares this repo
and nothing else.

The gateway is Green API (green-api.com), a hosted bridge that holds a WhatsApp session for a
phone number and exposes it over HTTP. Three facts about it shape everything below.

- **It is a journal, not a feed, and that suits a digest.** Incoming and outgoing messages land in
  journals the account reads back (`lastIncomingMessages` / `lastOutgoingMessages`, `?minutes=`),
  which is exactly the history read a once-a-day summary wants. The docs steer real-time consumers
  to webhooks instead; we deliberately have none.
- **Its authentication is unusual.** There is no `Authorization` header: the instance token is the
  **last path segment of every request URL**, glued into `{apiUrl}/waInstance{id}/{method}/{token}`.
  Any logged URL is therefore a credential leak.
- **A misconfigured instance fails silently.** With `incomingWebhook` set to `no` the incoming
  journal returns HTTP 200 and an **empty array** forever. "Quiet day" and "gateway was never
  configured" look identical on the wire.

The instance the client provisioned is `notAuthorized` today: nobody has scanned the QR yet. So
the feature had to be built to run end to end against a gateway that cannot answer, and to say so
in words an operator can act on.

## Decision

**1. Its own workspace and its own container.** `apps/whatsapp-digest` is a fourth npm workspace
and a third service in `docker-compose.prod.yml`, built from `apps/whatsapp-digest/Dockerfile` on
the same `node:22-slim` + `tsx` runtime posture as the API (ADR-0017) with no compile step. It has
no Traefik labels, no published port, and no healthcheck, because nothing listens. It does not
import `@burgers/shared`, it does not import the API's `env.ts`, and it owns a narrow zod schema of
its own — the satellite-entrypoint pattern `assistant-probe.ts` already set. A job with no product
surface has no business riding the boot, the env schema, or the blast radius of the API a floor
shift depends on.

**2. Green API over plain `fetch`, behind one port with one scriptable fake.** Six methods, all
plain GET/POST with the credentials in the path; `src/green-api-client.ts` carries the interface,
the real fetch-backed client, and `createFakeGreenApiClient` in one file, the `llm-client.ts` canon.
ADR-0013 settled the same question for the model (no vendor SDK) and the reasons hold here: one
dependency fewer, the timeout, retry, and redaction rules stay ours, and the test double is trivial.

**`setSettings` is deliberately absent from the port.** Requesting it **reboots the instance**, and
for the next ~5 minutes every other method returns HTTP 400. A job that flipped a setting would
break its own reads. Settings are a one-time operator action in the console; the job only reads
them.

**3. The credential rule is structural, not cosmetic.** Because the token is a path segment, the
URL is built inside a private closure, is never returned, never logged, and never interpolated into
an error. Failures carry the method name and the numeric status only
(`green-api getChats responded 429`), the catch reads `error.name` and never `.message` / `.stack`
/ `.cause` (undici puts the request URL in all three), and `createTokenRedactor` scrubs anything
crossing back out as a backstop. This is ADR-0011's error-class-only rule with a sharper edge.

**4. No database. The job is stateless: fetch, summarize, send.** The window is the journal's own
`minutes` parameter and the summary is regenerated whole each day, so there is nothing to remember
between runs except "has today already fired", which the scheduler holds in memory and re-derives
at boot from the wall clock. A store would buy de-duplication across runs, which the overlap window
and `idMessage` already give, at the cost of a migration, a connection string, and a second thing
to back up.

**5. Two run modes, and a timer that decides nothing.** `--once` runs immediately and exits: it is
how the job is tested by hand and the only way to read the digest while the recipient is blank. The
default is the long-running container. Its `setInterval` is dumb on purpose — it calls
`tick()` every minute and `tick()` consults the **injected clock**, exactly as `sync-triggers.ts`
does, so the daily fire is asserted by advancing a `MutableClock` rather than by waiting. No cron
library, no `vi.useFakeTimers` (the repo has none anywhere).

**6. Asia/Jerusalem is a wall clock, never an offset.** `tick()` fires when the local hour has
reached `DIGEST_FIRE_HOUR` (default 08:00) and today's local calendar date has not already fired.
Israel observes DST, so two days a year are 23 and 25 hours long and any "now plus 24h" next-fire
computation drifts across them; comparing a local date and hour cannot. The fired-date is claimed
**before** awaiting the run, and is seeded to today at construction when the process starts at or
past the fire hour, so neither a slow run nor a container restart can send a second digest.

**6a. Group chats only is not enough; an allowlist decides which groups.** *(Added 2026-08-28.)*
The suffix test below answers "is this a group", which was sufficient while the linked account was
assumed to be a dedicated line sitting in branch groups and nothing else. The first real
authorization was a person's own phone, and the journals immediately returned that person's work
team, a community group and a news feed alongside the test group — every one of which would have
been summarized by a model and mailed to a phone. `WHATSAPP_DIGEST_GROUPS` names the chatIds a run
may read; blank keeps the every-group behaviour, because a dedicated production number genuinely
wants it and a deploy that forgot the variable must not fall silent. The protection is therefore
opt-in and lives in `.env` beside the credentials. Ids, not names: a member can rename a group,
which would silently widen or empty an allowlist keyed on names.

**7. Group chats only, and the join that makes them readable.** The journals return `chatId` but
**no chat name**, so `getChats` is fetched once per run into a map purely to label groups. Group
membership is decided by the `@g.us` **suffix**, never by the id body: legacy ids are
`<number>-<timestamp>` and modern ones an opaque 18 digits, and a LID-mode instance can emit `@lid`.
A group's name may legitimately be an empty string, and a journal `chatId` may have no `getChats`
entry at all; both fall back to a stable label rather than a blank heading or a throw. Non-text
messages become Hebrew placeholders (`[תמונה]`, `[מסמך: ...]`) so a photo-heavy group reads as
activity instead of vanishing.

**8. Preflight first, and warnings that ride the outcome.** `getStateInstance` is called before
anything else because it is the only method that reports `notAuthorized` as a normal 200 body,
while every other method reports it as an HTTP 400 three calls later. `getSettings` follows as a
**read-only diagnostic**: `incomingWebhook`, the three outgoing toggles, and `enableLidMode` are
checked, and any problem is recorded in plain words and carried on the run's outcome. That is what
stops the silent-empty failure mode being reported as a quiet day.

**9. Two completions, Hebrew out, the transcript treated as data.** *(Amended 2026-08-28; this
decision originally read "one completion" and the owner asked for the two-stage shape below after
seeing what one call over every group at once produces.)*

The day is summarized per branch first — one call per group, all concurrent — and those summaries
are then merged by a second call. The merge is the reason the second call exists rather than a
refinement of the first: when three branches report the same broken supplier, the finding is one
line naming all three, and no per-branch summary can contain it because none of them can see the
others. A single call over every group at once fits in context and still degrades, spending its
attention unevenly across fifty branches and writing generically because nothing forces it to
finish one branch before starting the next.

Three consequences worth stating. A branch whose own call fails carries a placeholder into the
merge rather than vanishing, because a dropped branch reads as "nothing happened there"; only when
*every* branch failed is the run reported as a model failure instead of a quiet day. The merge is
skipped outright for a single branch, where a second call could only paraphrase the first and
paraphrasing is the step that invents detail. And both stages fence their input: a stage 1 summary
is model output derived from attacker-influenced text, so an injection surviving the first call
would otherwise arrive at the second one laundered as trusted content.

The token budgets are sized for a *thinking* model and look generous for the few lines of Hebrew
they produce. On the openrouter preset reasoning tokens count against the same `max_tokens`, and
`reasoning.max_tokens` is a hint the model overruns — measured, a 600-token budget for a two-line
branch summary finished `length` with an empty message every time.

**9a. The original single-completion note, still true of both calls:** The rendered transcript is text
typed by staff and customers, so it is wrapped in an explicit delimiter and the system turn states
that everything inside is material to summarize, never instructions to follow. The summary is
capped well under Green API's 20,000-character message ceiling (Hebrew is multi-byte, and nobody
reads a 20,000-character digest). When a journal read comes back at the 10,000-row cap the notice
reaches the **reader** of the digest, not only a log line.

**10. The recipient is deliberately blank, and that is a successful run.**
`WHATSAPP_DIGEST_RECIPIENT` ships empty. With it empty the job still checks the gateway, scans
every group, builds the transcript, writes the Hebrew summary, and reports it — and sends nothing,
because `main.ts` wires `createSkippedDigestSender` instead of the real one and warns in plain
words. This is the FCM push precedent (#59) exactly: the whole feature is exercised in production
long before it can reach a person, and switching sending on is one value, not a release. A blank
value parses; a **malformed** one (a `+`, a national leading zero, separators) fails fast at boot,
because a wrong number is a message to a stranger.

**11. A send is "accepted", never "sent".** HTTP 200 plus an `idMessage` means the message entered
the gateway's queue, where it can sit up to 24 hours before expiring. The result type says
`delivered: 'accepted'` and every log line names the id. The send is issued **exactly once with no
retry** — the read methods retry a 429 or a 5xx, a send does not, because a retried send is a
second WhatsApp message to a human.

## Considered options

- **A route or a scheduled tick inside the Fastify API.** Cheaper by a container, and rejected: it
  couples a job with no product surface to the API's boot, its required env (database, Drive, SMTP),
  and its deploy, and puts a WhatsApp gateway outage and a 60-second model call inside the process a
  floor shift depends on.
- **The Green API vendor SDK.** Six plain HTTP calls do not need a dependency, and wrapping them
  ourselves is what lets the token-redaction rule above be enforced at the only place a URL exists.
- **A self-hosted WhatsApp library (whatsapp-web.js, Baileys).** No gateway bill, and rejected:
  unofficial protocol access carries a real ban risk against the client's own business number, and
  it needs persistent session state, which contradicts the stateless decision. The client already
  has a Green API account.
- **A `seen message` table so runs never overlap.** Deferred: the 10-minute overlap on the window
  plus de-duplication by `idMessage` covers the documented 2-minute journal lag with no schema.
- **`node-cron` or an OS cron container.** Rejected for the injected-clock tick above, which is the
  only version of this that can be tested, DST included, without waiting a day.
- **Reading only the incoming journal.** Rejected: the business account's own replies are half of
  every conversation. The self-summarising trap that creates is closed structurally rather than
  by a filter — the recipient is a private `@c.us` chat, so the job's own sent digests can never
  survive the group-only filter.
- **Sending a "nothing happened today" line on a quiet day.** Not done: a daily message that is
  usually empty trains people to stop opening it. It is one branch in `digest-job.ts` if the owner
  disagrees, and it is his call.

## Consequences

- **The lockfile now names a fourth workspace, which breaks the two existing images until they are
  told about it.** `npm ci` validates the whole lockfile, so `apps/api/Dockerfile` and
  `apps/web/Dockerfile` each gained a manifest `COPY` line for the new package.json in the same
  change. Landing the lockfile without them stops the API and SPA images building.
- **CI picks up lint and typecheck for free, and tests not at all.** Biome runs over the tree and
  the root `typecheck` fans out with `--workspaces`, but the `test-api` job names one workspace by
  path, so a fifth job was added. Deploy is gated on CI success, so a red job here silently
  **skips** the entire production deploy with a grey tick.
- **A crashlooping digest container will not fail a deploy.** `scripts/deploy-vps.sh` builds every
  service in the compose file with no change, but its health wait inspects `burgers-bar-api-1` only,
  and this service has no healthcheck because nothing listens. The `GREEN_API_*` values must be in
  `/docker/burgers-bar/.env.prod` on the box **before** the merge lands, and the first deploy is
  followed by reading `docker logs burgers-bar-whatsapp-digest-1`.
- **The env surface grows by six keys**: three required (`GREEN_API_URL`, `GREEN_API_ID_INSTANCE`,
  `GREEN_API_TOKEN_INSTANCE`, all fail fast at boot) and three optional
  (`WHATSAPP_DIGEST_RECIPIENT`, `WHATSAPP_DIGEST_GROUPS`, `DIGEST_FIRE_HOUR`). The `ASSISTANT_*` provider keys are read
  through this app's own schema and shared with the API, not duplicated. `GREEN_API_URL` is
  per-instance (older instances answer on `api.green-api.com`, newer ones on a sharded host) and is
  configuration, never a constant.
- **The gateway's limits are now product limits.** 10,000 rows per journal read with no pagination
  to page past, 30 days of retention, up to 2 minutes of lag, and no history at all from before the
  instance's authorization. The cap detection is a heuristic on `rows.length` and reads as "the day
  may be incomplete", not as a certainty.
- **No test performs network I/O and no test sends a message.** Fakes live in `src` beside their
  ports so the job and its tests share one definition, the fetch adapter is covered with a stubbed
  `globalThis.fetch`, and the redaction assertion runs on every method's failure path rather than
  one. The blank-recipient guarantee is proved structurally: the model request is recorded and the
  fake's `sent` array is empty.
- **Running cost is now one completion PER BRANCH plus one merge, and five gateway reads a day.**
  At the chain's planned ~46 branches that is 47 completions daily rather than one. They are short
  and concurrent, so wall-clock stays flat as branches are added, but the per-day model spend scales
  with branch count where the single-call version did not. The documented 1 request/second
  per-instance limit on the reads only matters when `--once` is run repeatedly by hand.
- **`main.ts` is the one file no test covers**, by convention, which is why every decision lives in
  `digest-job.ts`, `send.ts`, `schedule.ts`, and `transcript.ts` and the entrypoint stays wiring.

## Operational prerequisites (not code)

Two things gate the first real run and neither can be solved by writing better code.

- **The instance must be authorized by QR.** Until then every run reports `gateway-not-ready` and
  names the reason. Afterwards the journal only backfills **from the moment of authorization**, and
  recovering older history needs a logout and a fresh authorization, so the first digest is
  legitimately thin. That is not a bug to debug.
- **The free Developer plan allows 3 chat correspondents per month** (error 466,
  `CORRESPONDENTS_QUOTA_EXCEEDED`). A feature whose entire premise is reading **every** group chat
  exhausts that on its first real run, so a paid Business-tier instance is a prerequisite. It is a
  billing decision for the owner, raised before the QR is scanned rather than after.

## Deferred

Per-group digests instead of one, a second recipient or a group as the recipient, a stored cursor
so a run resumes exactly where the last one stopped, media, and any reply path back into WhatsApp.
The seams they would arrive through already exist: the sender port in `send.ts`, the window in
`transcript.ts`, and the run outcome in `digest-job.ts`. Three values are visible to whoever reads
the digest and are the owner's to confirm rather than ours to assume: the 08:00 Jerusalem fire
hour, the trailing-24-hours window (rather than a calendar day), and the summary length cap.
