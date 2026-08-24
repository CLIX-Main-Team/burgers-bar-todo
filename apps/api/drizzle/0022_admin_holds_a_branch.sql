-- admin narrows to a single branch it owns; super_admin becomes the only chain-wide role
-- (2026-08-23 owner decision). Two steps, in this order, because they depend on each other.

-- 1. Promote the admins that are chain-wide TODAY, which is what a branch-less admin means under
-- the old model. Scoped to those rather than to every admin, because an admin that already holds
-- a branch is already the thing this migration is creating — promoting it would both hand a
-- branch manager the whole chain and leave a super_admin still carrying a location, which the
-- constraint in 0023 then rejects, failing the deploy. (Production had exactly that shape:
-- two admins, each already holding a branch.) Nobody loses access on deploy day.
UPDATE "users" SET "role" = 'super_admin' WHERE "role" = 'admin' AND "location_id" IS NULL;

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
