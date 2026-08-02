# Assistant knowledge corpus — Drive provisioning runbook

The out-of-band setup that lets the backend read the client's procedure corpus in Google
Drive. This is issue #86, a prerequisite of the Assistant (#83) named by ADR-0014. It is not
a code slice: it is one-way credential and access work done in the GCP console, the Render
dashboard, and the client's Drive, by a human with those accounts. The app code does not
perform any of it.

Do this before the sync slice (#87) runs against real Drive. Slice 1 itself lands green
against an injected fake Drive port, so this runbook does not block that ticket's merge — only
its real-Drive deploy and verification.

## What this provides, and what it does not

When it is done, the backend has exactly two pieces of configuration (see .env.example, the
"Google Drive knowledge corpus" section):

- DRIVE_CORPUS_FOLDER_ID — the id of the one shared folder the corpus lives in.
- GOOGLE_SERVICE_ACCOUNT_KEY — a read-only service account's JSON key, base64-encoded, held as
  a Render secret.

It does not provision the sync cursor. The changes.list page token is runtime state, not a
secret: Slice 1 bootstraps it on first run with changes.getStartPageToken and persists it in
the database. The acceptance criterion "folder id and initial cursor/channel state persisted
where the sync job reads them" is met by persisting the folder id here (config) and letting
Slice 1 establish the cursor (database) — there is nothing to hand-enter for the cursor, and
no push channel is registered at all, because ADR-0014 defers the changes.watch webhook.

## One-way doors — read before starting

Two choices here are expensive to reverse. Name them, do not step on them:

- The corpus is a plain Drive folder, not a Shared Drive. A Shared Drive is the clean
  primitive, but it is a Workspace feature the client's free plan does not have, and a consumer
  service account has no Drive storage quota to own the folder itself (ADR-0014). Once staff
  author procedures in the shared folder, moving to a Shared Drive is a content migration. Share
  a plain folder; do not "fix" this later by reaching for a Shared Drive unless the client moves
  to Workspace.
- The service-account key is a standing secret. Once it is live it grants read access to
  whatever the folder is shared to the account. Treat it like any production credential:
  Render secret only, never committed, rotated by issuing a new key and deleting the old.

## Steps

1. Create (or reuse) a GCP project and enable the Drive API.
   In the Google Cloud console, create a project for this integration (or reuse the project
   already holding the app's Google config). Under APIs and Services, enable the Google Drive
   API for that project. No billing account is required for read-only Drive API use at this
   scale.

2. Create the sync service account.
   Under IAM and Admin, Service Accounts, create one service account (for example
   drive-sync@<project>.iam.gserviceaccount.com). Give it no project IAM roles — it needs none.
   Its access to the corpus comes entirely from the folder share in step 5, not from any GCP
   role. Note the account's email address; the client shares the folder to exactly that address.
   Do not enable domain-wide delegation — that is a Workspace feature and is neither available
   on the free plan nor needed here.

3. Create a JSON key for the service account.
   On the service account, Keys, add a new key of type JSON, and download it once. This file is
   the secret. The drive.readonly scope is not set here — it is an OAuth scope the sync code
   requests when it authenticates with this key (https://www.googleapis.com/auth/drive.readonly),
   so the account is read-only by construction, never able to write or delete in the folder.
   Keep the file out of the repo and off shared drives; delete your local copy once it is in
   Render (step 4).

4. Store the key and folder config in Render.
   Base64-encode the key and set it as a Render secret environment variable on the API service:
     base64 -w0 service-account.json
   Set GOOGLE_SERVICE_ACCOUNT_KEY to that output, and set DRIVE_CORPUS_FOLDER_ID to the folder
   id from step 5. Both live in Render's environment for the API web service (secrets live in
   Render env vars — engineering-design.md, Hosting). Do not commit either value; .env.example
   documents the keys with empty placeholders only.

5. The client shares the corpus folder to the service account.
   The client, from the account that owns the folder, shares the one corpus folder to the
   service-account email from step 2 with the Viewer role. It must be a plain folder (its URL is
   drive.google.com/drive/folders/<id>), not a Shared Drive. The trailing <id> is
   DRIVE_CORPUS_FOLDER_ID. If the client keeps procedures in several folders, consolidate them
   under one shared folder — v1 syncs a single corpus folder.

6. Confirm the two config keys are in place where Slice 1 reads them.
   DRIVE_CORPUS_FOLDER_ID and GOOGLE_SERVICE_ACCOUNT_KEY are set in Render (prod) and documented
   in .env.example (the local contract). Locally both may be left blank to run with sync off.
   Nothing further is persisted by hand — the cursor bootstraps on Slice 1's first sync, as noted
   under "What this provides".

## Verification

Provisioning is verifiable only once Slice 1's sync exists; until then the check is that the
two config keys are present and well-formed. When Slice 1 is deployed, confirm end to end:

- The service account can list the folder. A first reconciliation reads the folder's files via
  the drive.readonly scope and upserts them into knowledge_docs without a 403 — a 403 means the
  folder was not shared to the exact service-account email, or was shared as a Shared Drive.
- A base64-decode of GOOGLE_SERVICE_ACCOUNT_KEY yields valid service-account JSON whose
  client_email matches the address the folder was shared to.
- A document added to the folder becomes answerable after a resync; a removed one stops
  grounding answers after a resync (ADR-0014).

## Rule-5 human review

This task introduces a standing production secret and read access to client documents, so it
carries rule-5 review before the secret goes live. Confirm, as the review:

- The service account has no project IAM roles and no domain-wide delegation — folder-share
  access only.
- The key is a Render secret, is not in git history, and the downloaded local copy was deleted.
- The folder shared is the intended corpus folder and only that, shared as Viewer (read-only),
  reinforcing the read-only OAuth scope.
- Key rotation is understood: issue a new JSON key, update the Render secret, then delete the
  old key.

## Traceability

Issue #86, sub-issue of #83. Decision: ADR-0014 (free-plan folder-share corpus, usage-driven
resync), building on ADR-0004 (Drive-authored knowledge base, local cache). Config surface:
.env.example and Render env (engineering-design.md, Hosting). Consumed by: the sync slice #87.
