ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_dim" integer;--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "content_hash" text;