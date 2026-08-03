-- The completed_at trigger (#134, Slice C; ADR-0002, umbrella #129). completed_at is
-- system-maintained, never typed by any write path: it is filled the moment a task enters `done`
-- and cleared the moment it leaves, so a status write (the employee status-only path or the
-- manager/admin full-update path) only ever sets `status` and this trigger keeps completion honest.
-- A hand-written migration because a trigger is not expressible in the Drizzle schema.
--
-- The guard `NEW.completed_at IS NULL` before stamping means: entering `done` from any other status
-- stamps a fresh completion time, re-confirming `done` on an already-done task preserves the original
-- stamp (idempotent), and a row inserted already carrying a completed_at (a test seed of a done task)
-- keeps it rather than being overwritten. Any status other than `done` clears the stamp outright, so
-- a reopened task is never left falsely marked complete.
CREATE FUNCTION set_task_completed_at() RETURNS trigger AS $$
BEGIN
	IF NEW.status = 'done' THEN
		IF NEW.completed_at IS NULL THEN
			NEW.completed_at := now();
		END IF;
	ELSE
		NEW.completed_at := NULL;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- BEFORE so the trigger edits the row being written (NEW) in place, INSERT OR UPDATE OF status so it
-- fires exactly on the writes that can move status: a create/seed (INSERT) and any status write
-- (UPDATE that sets the status column). A full-update that omits status never lists it in the SET,
-- so the trigger does not fire and an unrelated edit leaves completed_at alone.
CREATE TRIGGER tasks_set_completed_at
BEFORE INSERT OR UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION set_task_completed_at();
