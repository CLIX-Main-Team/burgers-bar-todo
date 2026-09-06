-- Digests asked for by name, with the keyword סיכום, rather than waited for at 08:00 (ADR-0026,
-- amended).
--
-- The shape of this table is decided by a constraint in the deployment rather than by the feature.
-- Two containers are involved and there is no channel between them: the webhook that hears the
-- keyword lives in the API, which holds only the webhook token and has neither Green API
-- credentials nor any sending code, while the job that can summarize and send is the digest
-- container, which has no inbound surface at all and must not grow one -- no ports, no Traefik
-- label, unreachable from the internet on purpose. The one thing the two share is this database.
-- So a request becomes a row here, and the digest container reads it on a tick it was already
-- waking up for.
CREATE TABLE "whatsapp_summary_requests" (
	-- The gateway's own id for the message that carried the keyword, and the primary key for one
	-- specific reason: Green API redelivers an unacknowledged notification every 60 seconds for 24
	-- hours. Keyed on anything generated here, one redelivery is a second summary -- a second full
	-- run of paid model calls and a second message into the group. Keyed on the message id, the
	-- insert is ON CONFLICT DO NOTHING and the whole feature is idempotent by construction.
	"id_message" text PRIMARY KEY NOT NULL,
	-- Where the answer goes. Recorded per request rather than read from configuration at send time,
	-- so an answer always returns to the chat that asked even if the configured recipient changes
	-- between the ask and the run.
	"chat_id" text NOT NULL,
	-- Who asked. It authorizes nothing today, since any member of the recipient chat may ask. It is
	-- here because "who keeps triggering this" is the first question anyone will ask about the bill.
	"requested_by" text,
	-- The gateway's event time for the keyword message, not the time we wrote the row. It survives
	-- redelivery unchanged, which is what makes it safe to reason about ordering with.
	"requested_at" timestamp with time zone NOT NULL,
	-- pending -> running -> done | failed | skipped. 'skipped' is a request refused by the cooldown
	-- and is a normal outcome, not an error: the asker is told how long is left rather than ignored.
	"status" text DEFAULT 'pending' NOT NULL,
	-- When the digest container claimed it. A row still 'running' long after this is a crashed run
	-- rather than a slow one, and the reclaim window keys off it. Without that, one crash leaves a
	-- corpse holding the lock and the feature is dead until someone notices.
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	-- Read back into the group when a run fails, so the person who asked is told rather than left
	-- waiting for something that is never coming.
	"error" text,
	CONSTRAINT "whatsapp_summary_requests_status" CHECK (
		"status" IN ('pending', 'running', 'done', 'failed', 'skipped')
	)
);
--> statement-breakpoint
-- The poller's only query: the oldest request still waiting. Partial, because every other row in
-- this table is history and will never be read by it.
CREATE INDEX "whatsapp_summary_requests_pending_idx"
	ON "whatsapp_summary_requests" ("requested_at")
	WHERE "status" = 'pending';
--> statement-breakpoint
-- The cooldown reads the last run that actually happened, which is the newest finished row.
CREATE INDEX "whatsapp_summary_requests_finished_idx"
	ON "whatsapp_summary_requests" ("finished_at");
--> statement-breakpoint
-- A manual digest must not overwrite the morning's.
--
-- whatsapp_digests was unique on digest_date alone, with saveDigest doing ON CONFLICT DO UPDATE and
-- resetting sent_at and id_message on the way past. That is right for a re-run of the daily job,
-- which rebuilds the same briefing. It is wrong the moment a second KIND of digest exists on the
-- same day: an on-demand summary at 15:00 would replace the 08:00 row and erase the record that the
-- morning digest was ever built or delivered.
ALTER TABLE "whatsapp_digests" ADD COLUMN "kind" text DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_digests" ADD CONSTRAINT "whatsapp_digests_kind" CHECK (
	"kind" IN ('scheduled', 'manual')
);
--> statement-breakpoint
DROP INDEX IF EXISTS "whatsapp_digests_date_idx";
--> statement-breakpoint
-- Still one scheduled digest per day, unchanged. Manual runs are simply appended, because there is
-- no natural key that makes two of them on one afternoon a conflict rather than two answers to two
-- questions.
CREATE UNIQUE INDEX "whatsapp_digests_scheduled_date_idx"
	ON "whatsapp_digests" ("digest_date")
	WHERE "kind" = 'scheduled';
