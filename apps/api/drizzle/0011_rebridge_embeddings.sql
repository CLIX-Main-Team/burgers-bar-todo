-- Re-embed the whole chunk index under the language-bridge scheme (2026-08 field audit):
-- Latin-dominant chunks now embed as title + generated Hebrew gist, so their stored vectors
-- are stale by construction. Nulling every embedding lets the next reconcile's backfill
-- (chunk-index.ts) regenerate the index in a handful of batches; until it lands, retrieval
-- degrades to keyword mode over the same chunks — the designed fallback, never an error.
UPDATE "knowledge_chunks" SET "embedding" = NULL;
