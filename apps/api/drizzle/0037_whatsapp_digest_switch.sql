-- The off switch for the WhatsApp daily digest (ADR-0026, amended).
--
-- Two of this job's four stages spend money or reach a person: the per-branch summaries and the
-- merge are paid model calls, and the send puts a message on somebody's phone. Everything else it
-- does is free and reversible. Until now the only way to stop those two was to stop the container,
-- and a stopped container is not off: the next deploy runs `compose up` and brings it back with no
-- trace that anyone had ever switched it off.
--
-- Hence a flag in the database rather than an env var. The database is the one piece of state that
-- outlives both the container and the deployment, and it is flipped with a single UPDATE, with no
-- release, no restart and no on-box file edit.
--
-- The row ships DISABLED. A default of true would mean this migration itself turns on spending the
-- moment it lands, against a corpus nobody has reviewed, on a schedule nobody is watching. The
-- expensive direction has to be the one somebody chooses out loud.
CREATE TABLE "whatsapp_digest_settings" (
	-- Singleton by construction, the same shape drive_sync_state uses: the primary key is fixed true
	-- and the CHECK pins it, so a second settings row cannot exist to disagree with the first.
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	-- The whole switch. False stops the per-branch summaries, the merge and the send together,
	-- deliberately as ONE flag: a digest that summarized but could not send would burn the day's
	-- model spend for a message nobody reads, so the two halves are never separately switchable.
	"enabled" boolean DEFAULT false NOT NULL,
	-- Free text for whoever flipped it, read straight back in the container's log when it declines to
	-- run. Not an audit trail, just the answer to "why is this off" at 08:00 three weeks from now.
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_digest_settings_singleton" CHECK ("whatsapp_digest_settings"."id")
);
--> statement-breakpoint
-- Seeded here rather than left to the application. A missing row and a row saying false are read the
-- same way by the job, so this is not what makes it safe; it is what makes the switch visible to
-- anyone who goes looking for it in the database, instead of a table that stays empty until the
-- first person thinks to write to it.
INSERT INTO "whatsapp_digest_settings" ("id", "enabled", "note")
VALUES (true, false, 'shipped off: summaries and sending stay switched off until the digest text has been reviewed and a recipient number exists')
ON CONFLICT ("id") DO NOTHING;
