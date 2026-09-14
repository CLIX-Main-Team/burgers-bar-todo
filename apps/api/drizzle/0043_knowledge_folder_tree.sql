CREATE TABLE "knowledge_folders" (
	"drive_folder_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"file_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_docs" ADD COLUMN "folder_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_docs" DROP COLUMN "folder_name";--> statement-breakpoint
-- The Knowledge tab stopped deriving its folders from the documents it could read, which was
-- wrong in two directions at once: a Drive folder holding nothing (or holding only files this
-- system never ingests — a photo, a video) produced no tile at all and read as broken rather than
-- empty, and a file filed below the top level reported the DEPARTMENT its branch begins with
-- instead of the folder it actually sits in, so a nested corpus looked flattened. Both are the
-- same root cause: folders existed only as a name copied onto each document row. They are their
-- own rows now, with their real parent and Drive's own file count, and a document points at the
-- folder it is actually in.
--
-- The cursor drop is the same trap migration 0042 documented, for the same reason: the incremental
-- path visits a file only when Drive reports a change to it, so without this every already-cached
-- row would keep a NULL folder_id until somebody edited that file, knowledge_folders would stay
-- empty until somebody touched a folder, and the tab would come up as one unfiled pile and stay
-- that way with nothing in the logs to say why. Dropping the cursor takes the never-synced branch
-- (ADR-0021), which walks the whole corpus and re-attaches every folder; the content hash keeps
-- that pass from re-chunking or re-embedding text that did not change.
DELETE FROM "drive_sync_state";
