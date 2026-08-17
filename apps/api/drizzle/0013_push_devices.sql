-- Registered phones, so a task assignment can reach someone who is not looking at the app (#59).
-- Keyed by the push registration token itself rather than a surrogate id, because the token *is*
-- the device's identity to Apple's and Google's delivery services: re-registering a phone rewrites
-- its one row, and a phone that changes hands moves to its new owner instead of ringing for both.
--
-- Purely additive — a new type, a new table, a new index, nothing touched on an existing one — so
-- it applies to a live database with no backfill and no downtime. It also lands ahead of any
-- Firebase project existing: with no push credentials configured the server registers devices here
-- and sends nothing, which is what makes turning notifications on later a configuration change
-- rather than a release.
--
-- (drizzle-kit also proposed re-adding knowledge_chunks.gist here: migration 0012 added that column
-- by hand and its snapshot was never updated to record it, so the generator saw it as missing. The
-- statement is dropped — the column exists in every database that has run 0012 — and the snapshot
-- beside this migration now records it, which settles the drift.)
CREATE TYPE "public"."push_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "push_devices" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "push_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_id_idx" ON "push_devices" USING btree ("user_id");
