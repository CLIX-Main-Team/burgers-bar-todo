-- Role-capability overrides (owner ask 2026-08-24: the Access page grows switches). Only
-- deviations from @burgers/shared CAPABILITY_DEFAULTS are stored, so this table starts and
-- may stay empty — an empty table IS the pre-switch app. Text columns validated against the
-- shared zod enums, as projects.roles/phase are, so growing either set needs no migration.
CREATE TABLE "role_capabilities" (
	"role" text NOT NULL,
	"capability" text NOT NULL,
	"allowed" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_capabilities_role_capability_pk" PRIMARY KEY("role","capability")
);
