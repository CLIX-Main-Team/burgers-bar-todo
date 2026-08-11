# The Knowledge tab files docs by LLM, not by Drive folder

Status: accepted. Decided when the owner asked for an admin tab showing the Knowledge Base
"organized like Google Drive" — and the real corpus turned out to be ~38 files flat in the root
with one lone subfolder, so mirroring Drive's structure would mirror the mess. The owner's call:
the app organizes it itself, per file, automatically for every future upload.

## Context

The Knowledge Base is authored in a shared Drive folder and mirrored into `knowledge_docs`
(ADR-0004, ADR-0021). Until now the mirror had no management surface at all: the only KB trace
in the UI was the assistant's source chips, and the resync endpoint (#89) was wired only in the
integration harness — the running server never registered the assistant routes.

Admins and managers need to see what the assistant knows: which docs are in, which were skipped
and why, and where a given file lives. Drive's own hierarchy cannot provide the "where" — the
corpus is a flat pile — and asking the client to keep Drive tidy reverses the ownership: the app
should absorb the mess, not police it.

An LLM port already exists (ADR-0013/0018/0022) with a scriptable fake, and the sync pass is the
one place every new or changed doc already flows through.

## Decision

1. **A fixed shelf list, stored per doc.** `knowledge_docs.category` (nullable text) holds one
   of seven slugs — procedures, finance, hr, reports, agreements, menu, general — defined next
   to the table in `db/schema.ts`. Plain text, not a pg enum, so growing the set is code-only.
   The web app owns the localized shelf names; slugs cross the wire.

2. **The categorizer files docs after every sync, inside the single-flight pass.**
   `knowledge-sync` gains an `afterReconcile` hook (a plain callback — the sync never learns
   about the LLM); the wire composes `createKnowledgeCategorizer` onto it when an `llm` is
   provided. The categorizer sweeps `category IS NULL` rows: one small completion per doc
   (title + a 500-char excerpt; title alone for skipped docs), `maxTokens` 16.

3. **Self-healing failure floor.** A transport failure (timeout/429/non-2xx fold to `ok:false`)
   leaves the doc NULL — the next pass retries it, so a rate-limited backfill completes itself
   across the ~20-minute backstop ticks. A reply that is not a recognizable slug is stamped
   `general`, so a misbehaving model cannot wedge a doc into a permanent unfiled state. The
   hook's own failure is reported and swallowed — filing is a tab nicety and must never fail a
   reconcile the assistant's grounding depends on. The UI shows NULL under General meanwhile.

4. **Re-filing on rename only.** The upsert keeps the category unless the title changed (SQL
   CASE on the conflict update): a rename is the one strong signal a doc belongs elsewhere,
   while content edits — far more common — do not spend an LLM call or churn shelves.

5. **The Drive port stays parents-free.** ADR-0023's posture holds: no folder path is threaded
   through the port or persisted. The one real subfolder's files (payroll checklists) classify
   correctly from their titles; a folder hint was considered and dropped as not worth reopening
   the port seam.

6. **The surface.** `GET /assistant/knowledge` (admin+manager, ADR-0007 tier of the resync)
   returns filing metadata only — never extracted content; the tab links each row to the
   original in Drive (`drive.google.com/file/d/<id>/view`). Registering this also finally wires
   the assistant routes into the running server — the ADR-0014 deferral ("once the real Drive
   adapter is in place") has been satisfied since ADR-0021. The web tab (`/knowledge`, gated
   `canProvision`) renders shelves → docs, with skipped docs badged and their reason shown.

## Consequences

- Every new corpus doc costs one small LLM completion at ingest; the one-time backfill of the
  existing ~39 docs rides the first post-deploy syncs (rate-limit failures roll to later
  passes). No cursor reset and no migration backfill: existing rows are NULL and the sweep
  finds them regardless of Drive changes.
- Filing quality is the model's. The floor is `general`, never a wrong-but-confident shelf for
  garbage replies; a misfiled doc self-corrects only on rename or a future re-filing feature.
- `skip_reason` is stored (and shown) in English — the extractor writes it. Localizing the
  known reasons is an open follow-up.
- The shelf list is fixed by design; a new shelf is a code change (slug + two locale labels),
  deliberately not owner-editable in v1.
