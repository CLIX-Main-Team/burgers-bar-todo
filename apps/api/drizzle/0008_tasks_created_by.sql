-- tasks.created_by (#258): who created the task, the PRD's "identity and place" field the v1
-- schema omitted. Hand-edited from the generated ADD COLUMN NOT NULL, which cannot land on a
-- database that already holds tasks: the column is added nullable, rows that predate it are
-- backfilled, and only then is NOT NULL enforced. On a fresh database (tests, a new environment)
-- the backfill touches zero rows and the constraint lands on an empty table.
--
-- The backfill target is the owner's admin by address (2026-08 owner decision: the pre-column
-- history is knowingly attributed to the current owner, not left blank) — named explicitly
-- because the production users table also carries the departed developer's older admin, which
-- an "earliest admin" rule would wrongly select. The COALESCE fallback (earliest admin) covers
-- any database where that address does not exist; a database with tasks but no admin at all
-- cannot occur (the first admin is seeded before any board write is possible, ADR-0005).
ALTER TABLE "tasks" ADD COLUMN "created_by" uuid;--> statement-breakpoint
UPDATE "tasks" SET "created_by" = COALESCE(
	(SELECT "id" FROM "users" WHERE "email" = 'clixteam579@gmail.com' AND "role" = 'admin'),
	(SELECT "id" FROM "users" WHERE "role" = 'admin' ORDER BY "created_at" ASC LIMIT 1)
) WHERE "created_by" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
