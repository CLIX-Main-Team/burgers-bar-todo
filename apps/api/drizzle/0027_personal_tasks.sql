-- A task nobody else can see (owner call 2026-08-25). The Personal tab used to mean "assigned
-- to me", which is a lens over the shared board: a manager or an admin still read every one of
-- those rows on their own board. Private is a different claim, and it has to be a property of
-- the row, because the thing that must change is what the scope predicate returns for OTHER
-- people (task-board/scope.ts).
--
-- Existing rows all default to false, which is the truthful backfill: every task written before
-- today was written on the shared board and has been visible to the branch all along. Silently
-- reclassifying self-assigned tasks as private would hide work the branch is running on.
ALTER TABLE "tasks" ADD COLUMN "personal" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- A private task belongs to a person, not to a branch, so it carries no branch. That is not a
-- convenience: a super_admin holds no location at all (users_role_location_check, 0023), and a
-- private list only they can see would otherwise be the one thing the chain's owner cannot have.
-- Shared work keeps the old rule, now stated as a constraint rather than only as a column type.
ALTER TABLE "tasks" ALTER COLUMN "location_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_location_or_personal_check" CHECK (
  "personal" OR "location_id" IS NOT NULL
);
--> statement-breakpoint
-- Every private read is "the rows I wrote", so the creator is the leading column. Partial,
-- because the shared board never asks this question and the index should not carry rows it will
-- never return.
CREATE INDEX "tasks_personal_creator_idx" ON "tasks" ("created_by") WHERE "personal";
