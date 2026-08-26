-- Who owns each step (owner call 2026-08-26). A task's checklist stopped being a private note to
-- the assignee the moment a five-step job could be split across five people, so a line carries a
-- SET of people, not one: "restock" is two people on a delivery day and one on a Tuesday.
--
-- A join table rather than a column, for the same reason task_assignees is one: the answer to
-- "who is on this" is a set, and a set in a column is a set you cannot join, index or constrain.
CREATE TABLE "task_checklist_item_assignees" (
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_checklist_item_assignees_pk" PRIMARY KEY ("item_id", "user_id")
);
--> statement-breakpoint
-- Cascade from the item: a deleted step's owners are not orphaned work, they are part of the step
-- that was deleted. Cascade from the user is deliberately NOT used — a user is deactivated, never
-- deleted, so this FK is a plain reference and a removed row would mean referential corruption.
ALTER TABLE "task_checklist_item_assignees" ADD CONSTRAINT "task_checklist_item_assignees_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."task_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_item_assignees" ADD CONSTRAINT "task_checklist_item_assignees_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- "Which steps is this person on" is the read behind auto-assignment and behind any later
-- per-person view; the composite PK already serves the other direction.
CREATE INDEX "task_checklist_item_assignees_user_id_idx" ON "task_checklist_item_assignees" USING btree ("user_id");
