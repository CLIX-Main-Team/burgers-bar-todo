-- A checklist on a task (owner call 2026-08-26). Tasks have carried a title, a description and a
-- status since the board shipped, and none of those answer "how far into this are we" for work that
-- is really five steps in a trenchcoat: restocking a branch, closing a shift, onboarding a hire.
--
-- Shaped exactly like project_checklist_items (0020) on purpose. The gesture is the same one — tick
-- a line, watch a count move — and two tables modelling one idea differently is how a tick starts
-- meaning different things depending on which screen you are standing on.
--
-- A table rather than a jsonb column on `tasks`: an item is a row somebody ticks, and every tick
-- against an array would be a read-modify-write of the whole task, racing every other tick on it.
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Cascade: a deleted task's checklist is not orphaned work somebody should later find, it is part
-- of the task that was deleted. Same call the project checklist made.
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Every board read hydrates checklists for a batch of task ids at once, so the id is the index.
CREATE INDEX "task_checklist_items_task_id_idx" ON "task_checklist_items" USING btree ("task_id");
