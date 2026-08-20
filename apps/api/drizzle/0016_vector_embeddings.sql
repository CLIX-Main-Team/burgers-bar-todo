CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
-- A row whose stored array is not the 1024-wide qwen3 cut cannot enter a vector(1024) column and
-- would abort the migration. Null it instead: the index pass re-claims null embeddings on its next
-- run, so an off-width vector (a historic experiment, a truncated write) heals itself rather than
-- wedging the deploy. Prod's corpus is uniformly 1024-wide, so there this touches nothing.
UPDATE "knowledge_chunks" SET "embedding" = NULL, "embedding_model" = NULL, "embedding_dim" = NULL
  WHERE "embedding" IS NOT NULL AND jsonb_array_length("embedding") <> 1024;--> statement-breakpoint
-- jsonb's text form of a float array ("[0.1, 0.2, ...]") is valid pgvector input, so the cast
-- converts every stored vector in place; NULLs stay NULL.
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024) USING ("embedding"::text)::vector(1024);
