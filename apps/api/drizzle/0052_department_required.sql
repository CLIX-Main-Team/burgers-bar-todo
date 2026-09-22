-- Every person sits in a department (owner ask 2026-09-21: "every role should have a
-- department, so when inviting a department input is a must"). 0050 added the column nullable
-- so the rows that predate it stayed valid; this closes it.
--
-- Backfill BEFORE the constraint, against whatever rows the live database holds: anyone still
-- unplaced, the super admin included, goes to management (the owner's own default, editable on
-- the Users page). The subquery, not a hard-coded id: 0050 seeds the departments with generated
-- ids, so the slug is the only handle that is the same on every database.
UPDATE "users"
SET "department_id" = (SELECT "id" FROM "departments" WHERE "slug" = 'management')
WHERE "department_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "department_id" SET NOT NULL;
