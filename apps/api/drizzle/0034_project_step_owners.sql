-- Who owns each step of a project's checklist (owner call 2026-08-28). A project checklist stopped
-- being a plan somebody reads the moment a branch opening carried forty steps across a shift: the
-- list is the work, and work with nobody's name on it is work nobody owns.
--
-- A mirror of task_checklist_item_assignees, on purpose. The gesture is identical on both screens,
-- and two tables modelling one idea differently is how a name on a line starts meaning different
-- things depending which page you are looking at.
--
-- A join table rather than a column, for the same reason that one is: the answer to "who is on
-- this" is a set, and a set in a column is a set you cannot join, index or constrain.
CREATE TABLE "project_checklist_item_assignees" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_checklist_item_assignees_pk" PRIMARY KEY ("item_id", "user_id")
);
--> statement-breakpoint
-- Cascade from the item: a deleted step's owners are not orphaned work, they are part of the step
-- that was deleted. Cascade from the user is deliberately NOT relied on — a user is deactivated,
-- never deleted, so this FK is a plain reference and a removed row would mean referential
-- corruption rather than tidy-up.
ALTER TABLE "project_checklist_item_assignees" ADD CONSTRAINT "project_checklist_item_assignees_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_item_assignees" ADD CONSTRAINT "project_checklist_item_assignees_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- "Which steps are mine, and how many of them are still open" is the read behind the project
-- card's red counter, and it runs once per project on every projects list. The composite primary
-- key already serves the other direction ("who is on this step").
CREATE INDEX "project_checklist_item_assignees_user_id_idx" ON "project_checklist_item_assignees" USING btree ("user_id");
