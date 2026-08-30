-- 0018 cut the priority ladder to normal/medium/high in the app but left 'low' in the type,
-- reasoning that a dead label costs nothing. It costs the board. Fastify serialises the tasks
-- response against taskPrioritySchema, which is the three-rung ladder, so ONE row carrying 'low'
-- answers GET /tasks with FST_ERR_RESPONSE_SERIALIZATION 500 — not a broken card, a blank board,
-- for every person whose scope contains it. Found 2026-08-30 when a seed script wrote two.
--
-- Nothing in the app can write that value: the request schema rejects it with a 400. What can is
-- everything that goes round the app — a seed, a fixture, a psql session, a restored dump — and
-- those are exactly the things that run against a chain's live database at the worst moment.
-- Removing the label is the only way the type stops being a loaded gun.
--
-- Postgres cannot drop an enum value, so the type is rebuilt: rename the old one aside, create the
-- three-rung one under the original name, move the column across, then drop what is left. The
-- column default has to come off first — it is a stored expression of the old type and would pin
-- it. The cast goes through text because the two types are unrelated as far as Postgres cares.
--
-- The UPDATE ahead of it is what makes the rebuild safe rather than a migration that fails on
-- somebody's data: 0018 already moved the rows that existed then, and this repeats it for anything
-- written since, on the same reasoning — whoever set 'low' meant "less than usual", and normal is
-- now the least a task can be.
UPDATE "tasks" SET "priority" = 'normal' WHERE "priority" = 'low';
--> statement-breakpoint
ALTER TYPE "public"."task_priority" RENAME TO "task_priority_old";
--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('normal', 'medium', 'high');
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "priority" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DATA TYPE "public"."task_priority" USING "priority"::text::"public"."task_priority";
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "priority" SET DEFAULT 'normal';
--> statement-breakpoint
DROP TYPE "public"."task_priority_old";
