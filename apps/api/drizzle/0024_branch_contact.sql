-- A branch was only a name (2026-08-23 owner ask). It now carries the three things you need to
-- actually reach or find one, which is also what gives the new branch detail page something to
-- edit. All three are nullable: every row that exists today has none of them, and a rename must
-- not become impossible until someone fills in an address.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "phone" text;
