CREATE TYPE "public"."knowledge_doc_status" AS ENUM('ingested', 'skipped');--> statement-breakpoint
CREATE TABLE "drive_sync_state" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"page_token" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_sync_state_singleton" CHECK ("drive_sync_state"."id")
);
--> statement-breakpoint
CREATE TABLE "knowledge_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drive_file_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"source_mime_type" text NOT NULL,
	"location_id" uuid,
	"status" "knowledge_doc_status" NOT NULL,
	"drive_modified_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_docs_drive_file_id_unique" ON "knowledge_docs" USING btree ("drive_file_id");