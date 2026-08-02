# The knowledge corpus is a free-plan shared folder, synced by usage-driven resync

ADR-0004 fixed the knowledge base as Google-Drive-authored, mirrored into a local `knowledge_docs`
cache read for grounding, with a Drive push-notification listener as the primary sync and a
reconciliation poll plus manual resync as backstops. The assistant-slices grilling (#57), reading
the Drive-sync research (#56) and one client fact — the folder owner is on Google's free plan
(personal Gmail, no Workspace) — settles the two things ADR-0004 left open: where the corpus lives,
and what actually drives the sync.

The corpus is a single ordinary Drive folder the client owns, shared to the sync service account as
Viewer. This is forced, not chosen: a dedicated Shared Drive — the clean primitive, tracked
unambiguously by the changes feed — is a Workspace feature the free plan does not have, and the
service account cannot own the folder itself because a consumer service account has no usable Drive
storage quota. A folder shared into the account lands in its "shared with me", where the
account-wide changes feed's coverage is the known weak spot (#56).

Because that push coverage is the uncertain part on a free plan, v1 does not lean on it. Sync is
driven by usage instead: one idempotent reconciliation function (`changes.list` from a persisted
page-token cursor, upsert or delete keyed on `drive_file_id`) is called on three triggers — when a
user logs in (fire-and-forget, so login never waits on or fails because of Drive, and single-flight
so a shift-open crowd collapses into one sync), a low-frequency backstop poll (~20 minutes, catching
edits made during a long-lived session), and a manual "resync now" action for the "I changed the
policy, make it live now" case. The `changes.watch` push webhook — with its public callback,
channel-renewal cron, and token/idempotency hardening — is deferred to a fast-follow, additive over
this same cursor and function. This reorders ADR-0004's "webhook primary, poll backstop" into
"usage-driven primary, webhook later"; ADR-0004's design (Drive-authored, local cache, grounding
reads the cache) is unchanged.

Ingestion widens #56's Google-Docs-only recommendation to the formats staff actually drop in the
folder: Google Docs (`files.export` text/plain), text-layer PDFs (downloaded and extracted via
pdf.js), and DOCX (via mammoth). Scanned or image-only PDFs — no text layer — are detected by
near-empty extraction and skipped with an admin-visible flag rather than answered from; OCR is out
of v1. Each ingested doc is truncated to a per-doc length cap, because grounding injects doc text
directly into the prompt (no embeddings, ADR-0004) and an over-long doc would blow the token budget.
Every doc is chain-wide in v1 (`location_id` NULL); per-location tagging stays the additive change
ADR-0004 anticipated.

## Consequences

- The corpus choice is a one-way door: once staff author in the shared folder, moving to a Shared
  Drive is a migration. It is recorded as forced by the free plan and revisited only if the client
  moves to Workspace — a later reader should not "fix" the folder-share by reaching for a Shared
  Drive.
- Freshness is bounded by the poll interval and login cadence, not instant. This is acceptable
  because procedures change rarely and manual resync covers "now"; the anti-fabrication guardrail,
  not cache freshness, is what keeps a stale or missing doc from producing a wrong answer.
- Deferring the webhook trades away near-instant propagation of an edit made while people are
  already working, for less to provision and no dependency on the shaky shared-with-me push
  coverage. Adding it later is additive over the persisted cursor.
- Ingestion carries two new dependencies (a pdf.js-based extractor and mammoth) and a format
  branch; a scanned PDF is a visible skip, never a silent wrong answer.
- Provisioning is a separate out-of-band task with one-way credential steps (GCP project, Drive API
  enabled, service account and JSON key stored as a Render secret, the client sharing the folder to
  the service-account email, the folder id and the cursor/channel state persisted). It must be done
  before the sync slice runs against real Drive. The service-account key is a standing secret and
  carries rule-5 review.
