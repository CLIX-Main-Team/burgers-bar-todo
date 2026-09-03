ALTER TABLE "knowledge_docs" ADD COLUMN "folder_name" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" DROP COLUMN "category";--> statement-breakpoint
-- The Knowledge tab now groups by the Drive folder a file actually sits in, and only the sync
-- knows what that is. The incremental path visits a file only when Drive reports a change to it,
-- so without this every already-cached row would keep a NULL folder until somebody edited it —
-- the tab would come up one unfiled pile and stay that way. Dropping the cursor makes the next
-- pass take the never-synced branch (ADR-0021), which lists the whole corpus folder and re-ingests
-- every file with its folder attached. That branch is the documented recovery for an expired page
-- token, so this is a path the sync already runs; re-chunking and re-embedding are skipped for
-- unchanged content by the content hash, so the cost is one listing plus one re-extract per file.
DELETE FROM "drive_sync_state";
