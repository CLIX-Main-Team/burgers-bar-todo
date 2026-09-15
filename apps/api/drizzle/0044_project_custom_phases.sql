-- A project's own statuses (owner ask 2026-09-15), named on that project and used by it alone.
-- Additive with a default, so every existing project simply starts with none.
ALTER TABLE "projects" ADD COLUMN "custom_phases" jsonb DEFAULT '[]'::jsonb NOT NULL;
