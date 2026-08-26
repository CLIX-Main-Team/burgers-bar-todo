-- How far each role sees (owner ask 2026-08-26: "it is a choice that the super admin can pick.
-- right now its fixed on the role. that is the default but the super admin should have the power
-- to change it per role"). The twin of role_capabilities, and stored the same way: only
-- deviations from @burgers/shared VIEW_SCOPE_DEFAULTS live here, so an empty table IS the
-- role-derived behaviour every scope predicate had before this. Text columns validated against
-- the shared zod enums, so adding a view or a horizon needs no migration.
CREATE TABLE "role_view_scopes" (
	"role" text NOT NULL,
	"view_key" text NOT NULL,
	"choice" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_view_scopes_role_view_key_pk" PRIMARY KEY("role","view_key")
);
--> statement-breakpoint
-- people.manageInvites was folded into people.invite on the same call ("One switch"), so any
-- override stored against the retired key is dead weight. The reader already ignores rows it
-- cannot parse; this clears them so the table keeps reading as "what the owner changed".
DELETE FROM "role_capabilities" WHERE "capability" = 'people.manageInvites';
