# The knowledge base full-loads on first sync and reconciles on a fixed interval

Status: accepted — amends ADR-0014. Decided while wiring the real Google Drive adapter (#210). Not
itself security-sensitive, but it stands up the standing service-account secret's first real
consumer, so the adapter and its wiring carry rule-5 review. ADR-0004's underlying design
(Drive-authored corpus, local `knowledge_docs` cache, grounding reads the cache) is unchanged;
ADR-0014's corpus choice (a free-plan shared folder, not a Shared Drive) is unchanged.

Numbered 0021 because 0019 (`0019-full-stack-e2e-with-fixture-cast.md`) and 0020
(`0020-iconography-phosphor-role-registry.md`) are taken, and 0018 is a prior collision — two files
claim it. This record takes the next genuinely free number, as 0020 did before it.

## Context

ADR-0014 fixed the sync as one idempotent reconciliation function walking Drive's `changes.list`
from a persisted page-token cursor, driven by three usage triggers: a fire-and-forget sync on login,
a ~20-minute backstop poll, and a manual "resync now". It assumed the corpus would be **authored
after** provisioning seeded the cursor — Drive's changes feed reports only changes at or after the
token, so anything already in the folder when the cursor is first captured is invisible to the feed
forever.

That assumption does not hold. The client provisioned the Drive infrastructure the opposite way: the
shared folder is **already populated** with procedure documents, and the service account is pointed
at it after the fact. Under the changes-feed-only model those pre-existing documents would never be
ingested, so the assistant — however well it reasons — could only ever answer "I don't have that
information". "Sync when the knowledge base is empty" has to mean "load what is already in the
folder", not "wait for a future edit".

Separately, the sync machinery existed and was unit-tested against a fake, but nothing built a real
Drive adapter or ran it: there was no `createGoogleDriveClient`, `google-auth-library` was not a
dependency, the credentials were not parsed at boot, and `server.ts` never started a scheduler. The
knowledge base was permanently empty in the running server.

## Decision

Three reversals of ADR-0014, plus the real adapter it deferred.

1. **Full load on the first ever sync, not changes-feed-only.** "Has the knowledge base ever synced?"
   is defined as **"does a sync cursor exist?"** (not "are there zero ingested docs" — a folder of
   only skipped scanned PDFs would look empty forever and full-load on every tick). With no cursor,
   the reconcile: captures the changes start-page-token **first** (so an edit made during the load is
   caught by the next incremental, not lost); lists every document in the folder and ingests each
   through the **existing** extraction pipeline (Google Doc export, PDF/DOCX download-and-extract,
   scanned → skipped row); and persists the cursor **last**, only on completion. A crashed or failed
   full load never writes the cursor, so the next tick retries it from scratch — safe because upserts
   are idempotent. Ingestion is **best-effort per document**: a genuine error on one file is logged
   and skipped so the rest of the corpus still loads. Once the cursor exists, every later reconcile is
   the unchanged incremental `changes.list` drain, which stays **fail-whole-pass** (the asymmetry is
   deliberate — the incremental cursor advances *through* the feed, so swallowing a per-change error
   would advance past a lost edit; the full load captures its token up front and does not advance
   per-document, so best-effort is safe there).

2. **Boot fire + fixed 20-minute interval as the trigger model, not login + backstop + manual.** The
   **login-triggered sync is dropped**: login no longer touches Drive at all. The server, once
   listening, fires one reconcile **fire-and-forget** (the full load on a fresh deploy, an immediate
   incremental catch-up on a restart), then repeats on a 20-minute `setInterval` reusing the existing
   clock-injected interval trigger. A single server instance is assumed (Render free tier), so the
   in-process timer needs no distributed lock; the timer is torn down in `onClose` before the pool
   closes. The manual "resync now" endpoint is deferred as an additive fast-follow (the trigger stands
   ready; only the route is unbuilt).

3. **Adapter-side folder filtering over the account-wide feed.** Drive's `changes.list` is
   account-wide ("shared with me"), not folder-scoped. All scoping lives **inside the real adapter**
   so the sync never learns about parents: `listFiles` queries the one folder server-side, and
   `listChanges` forwards a change as an upsert only when the folder is a parent — every removal,
   trash, or move-out is forwarded as a deletion (the repository delete-by-drive-file-id is an
   idempotent no-op for unknown ids, so this can never corrupt the cache). Flat only — no subfolder
   recursion.

The **real adapter** (`createGoogleDriveClient`) authenticates a service account via
`google-auth-library`'s JWT client (scope `drive.readonly`) and makes all Drive calls with raw
`fetch`, matching the fetch-based, not-unit-tested-against-live posture of `createHttpLlmClient`. The
`DriveClient` port gains one capability, `listFiles()`; the other operations are unchanged. The two
credentials (`GOOGLE_SERVICE_ACCOUNT_JSON`, base64-encoded; `DRIVE_FOLDER_ID`) are **required** at
boot — a missing or malformed key fails the deploy loudly rather than running a permanently empty
knowledge base.

## Consequences

- A fresh deployment against a populated folder fills its knowledge base automatically within a short
  window of boot, with no re-upload and no human action. The first-load window is user-invisible: the
  boot fire is fire-and-forget, so during it the answer path behaves exactly as before — an honest "I
  don't have that information", never an error.
- Login is now instant and Drive-independent by construction: sign-in cannot be delayed or failed by a
  slow or broken Drive, because it no longer touches Drive.
- Freshness is bounded by the 20-minute interval (and the boot catch-up), not by login cadence. This
  is acceptable for the same reason ADR-0014 gave: procedures change rarely, and the anti-fabrication
  guardrail — not cache freshness — is what keeps a stale or missing doc from producing a wrong answer.
- Making the credentials required is a one-way tightening: `make dev` now needs a dev service-account
  key and a dev folder, the same required configuration as production (the integration harness is
  unaffected — it injects a fake Drive and never loads the env). The service-account key is a standing
  secret under rule-5 review; a wrong `DRIVE_FOLDER_ID` or an unshared folder yields an empty full
  load (zero documents) with no error, so it is worth verifying with a throwaway probe.
- The interval is a code constant (`BACKSTOP_POLL_INTERVAL_MS`), not an env var, and assumes one
  server instance. A move to multiple instances would need a distributed lock — noted, not built.
- The deferred pieces are unchanged from ADR-0014's posture and remain additive over this same cursor
  and function: the manual resync endpoint, the `changes.watch` push webhook, OCR for scanned PDFs,
  per-location document tagging, and subfolder recursion.
