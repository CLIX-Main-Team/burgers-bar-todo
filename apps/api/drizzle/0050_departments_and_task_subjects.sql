-- Departments (owner ask 2026-09-20, from the client's list). A fixed set of seven in this
-- update: nothing in the app edits the table, so the seed below IS the list. Both names live on
-- the row rather than in the message catalog so a later editor has somewhere to write.
-- Unrelated to knowledge_docs.department, which is the assistant's filing of a document.
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_he" text NOT NULL,
	"name_en" text NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "departments" ("slug", "name_he", "name_en", "position") VALUES
	('management', 'מנהלה', 'Management', 1),
	('operations', 'תפעול', 'Operations', 2),
	('procurement', 'רכש', 'Procurement', 3),
	('marketing', 'שיווק', 'Marketing', 4),
	('call_center', 'מוקד', 'Call center', 5),
	('finance', 'כספים', 'Finance', 6),
	('customer_service', 'שירות לקוחות', 'Customer service', 7);
--> statement-breakpoint
-- A person sits in at most one department. Nullable with no backfill: null is "not placed yet",
-- and the board fails closed for such a person (task-board/scope.ts) rather than guessing.
ALTER TABLE "users" ADD COLUMN "department_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- A subject is the card a department's work is filed under. Deletion is refused while tasks
-- still point at it (the write service), so no cascade: a subject going would otherwise take a
-- department's tasks with it in silence.
CREATE TABLE "task_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_subjects" ADD CONSTRAINT "task_subjects_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "task_subjects" ADD CONSTRAINT "task_subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "task_subjects_department_name_unique" ON "task_subjects" ("department_id", lower("name"));
--> statement-breakpoint
CREATE INDEX "task_subjects_department_idx" ON "task_subjects" ("department_id");
--> statement-breakpoint
-- The shared tasks that exist today are seeded test rows written before subjects existed and
-- have no department to be filed under (owner call 2026-09-20: delete them). Personal tasks stay.
-- Assignees and checklist rows go with them through their existing cascades.
DELETE FROM "tasks" WHERE NOT "personal";
--> statement-breakpoint
-- Every shared task sits in exactly one subject; a private task has none, the mirror of the
-- location rule in 0027. A task's department is its subject's, read through the join — there is
-- no second column to drift.
ALTER TABLE "tasks" ADD COLUMN "subject_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subject_id_task_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."task_subjects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subject_or_personal_check" CHECK (
  "personal" OR "subject_id" IS NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tasks_subject_idx" ON "tasks" ("subject_id");
