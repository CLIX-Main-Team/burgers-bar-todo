-- A project runs at MANY branches, not one (owner call 2026-08-23). The single nullable
-- location_id becomes a uuid array, where an EMPTY array is the chain-wide case the NULL used to
-- carry. Existing rows keep exactly the reach they had: a branch project becomes a one-element
-- array, a chain-wide one becomes an empty array.
ALTER TABLE "projects" ADD COLUMN "location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;
--> statement-breakpoint
UPDATE "projects" SET "location_ids" = ARRAY["location_id"] WHERE "location_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "location_id";
