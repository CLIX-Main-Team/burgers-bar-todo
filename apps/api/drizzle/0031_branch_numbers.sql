-- The chain knows its branches by number (client sheet 2026-08-27, branches 1-46), so the app
-- should speak the same language: the number is the list's sort key and how a branch is found.
-- Nullable because the testing branch carries none, and unique so two branches can never claim
-- the same number — NULLs are exempt from a unique index, so any count of unnumbered rows is fine.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "locations_number_unique" ON "locations" ("number");
