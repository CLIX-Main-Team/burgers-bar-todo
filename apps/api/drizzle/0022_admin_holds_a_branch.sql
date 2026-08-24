-- admin narrows to a single branch it owns; super_admin becomes the only chain-wide role
-- (2026-08-23 owner decision). Two steps, in this order, because they depend on each other.

-- 1. Every existing admin is chain-wide and branch-less today, so promoting them is the only
-- move that satisfies the constraint below without inventing a branch assignment for a real
-- person. Nobody loses access on deploy day; branch admins are appointed by hand afterwards.
UPDATE "users" SET "role" = 'super_admin' WHERE "role" = 'admin';

-- 2. location_id has always been nullable with only the service enforcing "a manager or employee
-- has a branch", so a legacy or seeded row could violate the constraint and fail this migration
-- halfway through a deploy. Fail loudly, naming the rows, rather than on a constraint error.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE "role" <> 'super_admin' AND "location_id" IS NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users without a branch cannot be migrated: %', offenders;
  END IF;
END $$;
