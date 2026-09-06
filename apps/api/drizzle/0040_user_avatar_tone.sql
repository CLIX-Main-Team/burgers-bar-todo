-- The colour a person chose for their avatar disc (Profile page, owner ask 2026-09-04). The
-- eight values are the eight person tones the web app already paints; the number is the index
-- of the class pair the disc wears. NULL is "automatic": the disc keeps the colour hashed from
-- the display name, exactly as every avatar was coloured before this column existed, so nobody's
-- face changes until they choose one themselves.
ALTER TABLE "users" ADD COLUMN "avatar_tone" smallint;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_tone_range_check" CHECK ("avatar_tone" IS NULL OR ("avatar_tone" BETWEEN 1 AND 8));
