-- A subject may belong to one branch (owner ask 2026-09-20, the evening after the departments
-- update): a branch admin sees every department, and files subjects of their own under their
-- branch. The chain's subjects keep a null branch and are seen by every branch. A name may
-- repeat across branches (each branch's "Opening shift"), so the unique rule gains the branch,
-- the null branch standing in as the zero uuid so it takes part in the index like any other.
ALTER TABLE "task_subjects" ADD COLUMN "location_id" uuid;
--> statement-breakpoint
ALTER TABLE "task_subjects" ADD CONSTRAINT "task_subjects_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP INDEX "task_subjects_department_name_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "task_subjects_department_branch_name_unique" ON "task_subjects" ("department_id", coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
--> statement-breakpoint
CREATE INDEX "task_subjects_location_idx" ON "task_subjects" ("location_id");
