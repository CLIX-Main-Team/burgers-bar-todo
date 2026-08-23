CREATE TABLE "project_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_checklist_items_project_id_idx" ON "project_checklist_items" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "roles" text[] DEFAULT '{"manager"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "lead_id";--> statement-breakpoint
UPDATE "projects" SET "phase" = NULL WHERE "phase" IS NOT NULL AND "phase" NOT IN ('planning','preparation','in_progress','review','completed');--> statement-breakpoint
UPDATE "projects" SET "phase" = 'planning' WHERE "phase" IS NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "phase" SET DEFAULT 'planning';--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "phase" SET NOT NULL;
