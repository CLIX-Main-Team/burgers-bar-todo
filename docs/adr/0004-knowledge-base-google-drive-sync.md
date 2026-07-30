# Procedures/policies knowledge base lives in Google Drive, synced into a local cache

The Assistant grounds answers on two sources: task data (structured queries against the
existing task tables) and the chain's procedures/policies. For the latter we do not build an
in-app document editor. The procedures/policies are authored by staff in a shared Google Drive
folder and synced into a local `knowledge_docs` cache; grounding always reads the cache, never
Drive live. Sync is driven by a Drive push-notification listener (primary), backstopped by a
low-frequency reconciliation poll and a manual "resync now" action.

We chose this because a Workspace-native small business already edits Google Docs, so Drive is
a free authoring surface with nothing to build; and a local cache keeps the synchronous answer
path (ADR-0003) fast and off Drive's critical path, so a slow or unavailable Drive never breaks
an answer. There is no vector search or embeddings in v1 — the corpus is a handful of short
docs, small enough to select and inject relevant docs directly; embeddings would be
gold-plating at this scale and can be added over the same cache table later if the corpus grows.

The knowledge base is chain-wide in v1, but the cache carries a nullable `location_id`
(NULL = chain-wide) from day one, so per-location knowledge is a purely additive change rather
than a migration.

## Consequences

- Introduces a Google Drive integration: a service account with read access to the one folder,
  plus push-notification channels. Those channels expire and must be re-registered, and a
  missed notification would silently stale the cache — which is exactly why the reconciliation
  poll and manual resync exist as backstops.
- The cache is eventually-consistent with Drive. This is acceptable because procedures change
  rarely; the manual resync covers the "I just changed the policy and need it live now" case.
- Freshness does not guard correctness — a stale or missing doc is handled by the
  anti-fabrication guardrail (the Assistant says it has no procedure for something rather than
  inventing one), not by assuming the cache is current.
