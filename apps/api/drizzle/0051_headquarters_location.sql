-- The company headquarters as a location row (owner ask 2026-09-21, ADR-0029). "Not literally a
-- branch, but a branch for this system": the row every office role holds, so that from here on
-- the only branch-less person in the chain is the owner. A location is now one of two kinds, and
-- everything that counts or lists branches filters on it.
ALTER TABLE "locations" ADD COLUMN "kind" text DEFAULT 'branch' NOT NULL;
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_kind_check" CHECK ("kind" IN ('branch', 'headquarters'));
--> statement-breakpoint
-- Exactly one head office. A partial unique index over a constant: every row of the kind
-- collides with every other, so a second one cannot be inserted.
CREATE UNIQUE INDEX "locations_one_headquarters" ON "locations" ("kind") WHERE "kind" = 'headquarters';
--> statement-breakpoint
-- The row itself, seeded here so no one has to click it in on production (owner note, item 7).
-- Hebrew name because the chain's own branch rows are Hebrew; no branch number, which is the
-- chain's numbering of its restaurants and this is not one. Guarded so a hand-applied re-run on a
-- database that already carries the row (the prod runbook) adds nothing.
INSERT INTO "locations" ("name", "kind")
SELECT 'מטה החברה', 'headquarters'
WHERE NOT EXISTS (SELECT 1 FROM "locations" WHERE "kind" = 'headquarters');
--> statement-breakpoint
-- The branch rule, recut a third time (0023: the owner alone is branch-less; 0033: only the
-- branch trio holds a location). Now: the owner alone is branch-less and EVERY other role holds a
-- location — a branch, or the head office. The office accounts that exist today are branch-less
-- by 0033's rule, so they move to the head office first; only then can the new constraint hold.
ALTER TABLE "users" DROP CONSTRAINT "users_role_location_check";
--> statement-breakpoint
UPDATE "users"
SET "location_id" = (SELECT "id" FROM "locations" WHERE "kind" = 'headquarters'), "updated_at" = now()
WHERE "location_id" IS NULL AND "role" <> 'super_admin';
--> statement-breakpoint
-- Fail loudly, naming the rows, rather than on an opaque constraint error, exactly as 0023 and
-- 0033 did. After the backfill the only way a row offends is a super_admin holding a location.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE (
    ("role" = 'super_admin' AND "location_id" IS NOT NULL)
    OR ("role" <> 'super_admin' AND "location_id" IS NULL)
  );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users violating the branch rule cannot be migrated: %', offenders;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_location_check" CHECK (
  ("role" = 'super_admin' AND "location_id" IS NULL)
  OR ("role" <> 'super_admin' AND "location_id" IS NOT NULL)
);
