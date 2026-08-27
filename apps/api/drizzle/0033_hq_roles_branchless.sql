-- The branch rule, recut for the HQ roles (0032): only the branch trio holds a location now.
-- 0023 said "super_admin alone is branch-less"; with 14 chain-wide roles that framing inverts,
-- and the honest statement is the trio's. The service already enforces this in
-- resolveBakedFields; the constraint is defence in depth for any path that bypasses it, and it
-- is what makes the rule true of the data rather than merely remembered by the code.
--
-- Every existing row satisfies both the old rule and the new one (only the four original roles
-- exist in data, and 0023's constraint held them to it), so no row should offend. Fail loudly,
-- naming the rows, rather than on an opaque constraint error, exactly as 0023 did.
ALTER TABLE "users" DROP CONSTRAINT "users_role_location_check";

DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE (
    ("role" IN ('admin', 'manager', 'employee') AND "location_id" IS NULL)
    OR ("role" NOT IN ('admin', 'manager', 'employee') AND "location_id" IS NOT NULL)
  );
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users violating the branch rule cannot be migrated: %', offenders;
  END IF;
END $$;

ALTER TABLE "users" ADD CONSTRAINT "users_role_location_check" CHECK (
  ("role" IN ('admin', 'manager', 'employee') AND "location_id" IS NOT NULL)
  OR ("role" NOT IN ('admin', 'manager', 'employee') AND "location_id" IS NULL)
);
