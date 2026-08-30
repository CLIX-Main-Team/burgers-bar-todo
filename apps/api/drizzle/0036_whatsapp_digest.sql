-- The WhatsApp daily group digest gains a memory (ADR-0026, amended). The job shipped stateless —
-- fetch, summarize, send, remember nothing — and that held while the summary was ONE completion.
-- It is now one completion per branch plus a merge, so a refused send throws away every one of them
-- and a re-run pays for all of them again. A summary nobody kept is also a summary nobody can
-- check: there was no way to hold a suspicious cross-branch merge up against what the branches
-- actually said.
--
-- Four tables, and the split between them is the retry story. Messages are the raw record, summaries
-- are stage 1's output, digests are stage 2's, and each layer can be rebuilt from the one below
-- without re-running the layer above it.
--
-- Declared in apps/api's schema because this repo has one migration pipeline and deploy.yml runs it
-- against Supabase before any container starts. The digest app does not import these declarations;
-- it reaches the same database over plain parameterised SQL.

-- The chat directory. A journal row carries a chatId and no name, so the name is learned once and
-- kept. branch_id is nullable in both directions of meaning: a group may not be mapped onto a
-- Location yet, and the linked account sits in groups that are not branches at all.
CREATE TABLE "whatsapp_chats" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- No cascade. A branch is renamed or closed, never deleted, and a chat row outliving its mapping is
-- a directory entry to re-point rather than referential corruption.
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- One row per message, flat, with chat_id repeating. Five groups on a busy day are hundreds of rows
-- and never five: a group's day is a set of messages, each with its own sender and time.
CREATE TABLE "whatsapp_messages" (
	-- Green API's own idMessage. This is what makes the overlapping ingest safe: consecutive runs
	-- re-fetch the same messages deliberately, so no gap can open between them, and this key is what
	-- collapses the duplicates instead of letting them accumulate.
	"id_message" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	-- Who wrote it, which inside a group is never the same question as which chat it landed in.
	-- Nullable because an OUTGOING journal row has no sender: the sender is the linked instance
	-- itself, and the wire simply omits the field rather than naming the account.
	"sender_id" text,
	-- Kept alongside sender_id, not instead of it: a WhatsApp display name is whatever its owner set
	-- it to this week, while the id is stable and is what a users row could eventually join on.
	"sender_name" text,
	-- textMessage, imageMessage, and so on. Without it a null body cannot be told apart from a photo,
	-- and every photo-only message would silently vanish from the digest.
	"type_message" text NOT NULL,
	"text_message" text,
	-- The caption on a photo and the name of a file. Not cosmetic: once the DIGEST reads its day from
	-- this table rather than from the gateway, a column we did not persist is content the summary can
	-- never see — every photo and document would reach the model as a bare "[תמונה]" with the one
	-- word that said what it was thrown away.
	"caption" text,
	"file_name" text,
	"direction" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Every read of this table is "this chat, over this stretch of time": the per-branch summary, the
-- digest window, and the retention purge.
CREATE INDEX "whatsapp_messages_chat_id_sent_at_idx" ON "whatsapp_messages" USING btree ("chat_id","sent_at");--> statement-breakpoint

-- Stage 1's output: one row per branch per day. Kept so stage 2 can be retried without paying for
-- stage 1 again, and so a branch's day can still be read long after its messages are purged.
CREATE TABLE "whatsapp_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" text NOT NULL,
	-- Denormalised deliberately: the name the summary was WRITTEN under. A group renamed in March
	-- must not silently retitle February's summaries.
	"chat_name" text NOT NULL,
	-- A plain YYYY-MM-DD Asia/Jerusalem local date, stored as text rather than as `date` on purpose.
	-- It is a wall-clock day, not an instant, and a real date column invites a driver or a session
	-- timezone to reinterpret it — which is exactly how a digest ends up filed under the wrong day.
	"summary_date" text NOT NULL,
	"summary" text NOT NULL,
	"message_count" integer NOT NULL,
	-- Which model wrote it: the one thing you want when comparing quality across a model swap, and
	-- impossible to reconstruct after the fact.
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The id_message trick one level up: re-running a day upserts its summaries rather than stacking a
-- second set that stage 2 would then read twice.
CREATE UNIQUE INDEX "whatsapp_summaries_chat_date_idx" ON "whatsapp_summaries" USING btree ("chat_id","summary_date");--> statement-breakpoint

-- Stage 2's output and what became of it. Written BEFORE the send is attempted, which is the whole
-- point of the table: a refused send must not destroy five model calls, and sent_at being null is
-- precisely the "built but never delivered" state a retry looks for.
CREATE TABLE "whatsapp_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digest_date" text NOT NULL,
	"message" text NOT NULL,
	"group_count" integer NOT NULL,
	"message_count" integer NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- "Accepted", never "delivered": a 200 from sendMessage means the message entered Green API's
	-- queue, where it can wait up to 24 hours. Delivery is a separate webhook this job does not read.
	"sent_at" timestamp with time zone,
	"id_message" text
);
--> statement-breakpoint
-- One digest per day, so a second run of the same day replaces its row instead of sending twice.
CREATE UNIQUE INDEX "whatsapp_digests_date_idx" ON "whatsapp_digests" USING btree ("digest_date");
