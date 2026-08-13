-- The language bridge runs both ways now (ADR-0025 addendum): every chunk is restated once at
-- index time in the other language and the result is stored here, so retrieval's keyword arm can
-- match a question against a document written in the language the asker did not use.
--
-- Deliberately no `UPDATE ... SET embedding = NULL` to schedule the backfill, as migration 0011
-- used: the index pass now claims embedded-but-gist-less chunks on its own, so the existing
-- vectors stay in place and retrieval keeps working at full strength while the gists fill in
-- behind it. Nulling them would blind the vector arm for the length of the pass.
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "gist" text;
