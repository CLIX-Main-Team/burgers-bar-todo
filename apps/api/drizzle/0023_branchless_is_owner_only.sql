-- Only the chain-wide role is branch-less (2026-08-23). The service already enforces this in
-- resolveBakedFields; the constraint is defence in depth for any path that bypasses it, and it is
-- what makes the rule true of the data rather than merely remembered by the code.
--
-- location_id has always been nullable with only the service enforcing "a manager or employee has
-- a branch", so a legacy or seeded row could violate this and fail the migration halfway through a
-- deploy. Fail loudly, naming the rows, rather than on an opaque constraint error.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE "role" <> 'super_admin' AND "location_id" IS NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users without a branch cannot be migrated: %', offenders;
  END IF;
END $$;

ALTER TABLE "users" ADD CONSTRAINT "users_role_location_check" CHECK (
  ("role" = 'super_admin' AND "location_id" IS NULL)
  OR ("role" <> 'super_admin' AND "location_id" IS NOT NULL)
);
