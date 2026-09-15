-- The task-to-project link goes (owner call 2026-09-15). A project's work has been its own
-- checklist since 2026-08-26, and nothing on screen has set or shown a task's project since; the
-- column and its index were dead weight. Any value still in it is a filing nobody can see.
DROP INDEX IF EXISTS "tasks_project_id_idx";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "project_id";
