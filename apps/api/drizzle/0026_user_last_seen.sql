-- When this person last used the app (round 12, People). Presence is a property of the
-- PERSON, not of a session: a session row is deleted by logout, by a completed reset, and
-- by deactivation (ADR-0006), so deriving "last active" from sessions.last_used_at would
-- report a staff member who signed out at end of shift as never having signed in at all.
-- Stamping the users row survives all three. NULL means "has never signed in" — the state
-- every invited user starts in, and the one a freshly created row inherits.
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;
--> statement-breakpoint
-- Backfill from the sessions that still exist. Without this the roster launches blank —
-- every existing employee reading as "never signed in" until they next open the app — while
-- the honest answer for most of them is already sitting in the sessions table. It is a
-- floor, not the whole truth: someone whose only session was revoked by a logout or a reset
-- has left no trace to recover, and correctly stays NULL until their next request.
UPDATE "users" u
SET "last_seen_at" = s."max_used"
FROM (
  SELECT "user_id", max("last_used_at") AS "max_used" FROM "sessions" GROUP BY "user_id"
) s
WHERE s."user_id" = u."id";
