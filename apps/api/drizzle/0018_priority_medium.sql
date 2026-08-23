-- Priority becomes a ladder that starts at the floor (owner call 2026-08-21): normal, medium,
-- high. The old set was low, normal, high — a baseline in the middle with a rung below it that
-- nobody ever set, and no rung between "the default" and "urgent", which is the one a shift
-- actually reaches for.
--
-- 'medium' is ADDED after 'normal' rather than 'low' being renamed, so the type's own order
-- still reads as the ladder. An enum's order is fixed when a value is created and Postgres
-- cannot move one afterwards, so a rename would have left medium sitting below normal forever.
--
-- The rows that carried 'low' drop to 'normal', not to 'medium'. Whoever set them meant "less
-- than usual", and normal is now the least a task can be; promoting them to the new middle rung
-- would invent an urgency nobody asked for.
--
-- 'low' itself stays in the type, unused and unreachable from the app: Postgres cannot drop an
-- enum value, and rebuilding the type to be rid of one dead label is not worth a table rewrite.
ALTER TYPE "task_priority" ADD VALUE IF NOT EXISTS 'medium' AFTER 'normal';
--> statement-breakpoint
UPDATE "tasks" SET "priority" = 'normal' WHERE "priority" = 'low';
