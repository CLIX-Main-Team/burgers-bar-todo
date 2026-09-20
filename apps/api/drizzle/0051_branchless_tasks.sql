-- A shared task may belong to no branch (owner ask 2026-09-20): department work like a budget
-- or a campaign is nobody's branch's, and pinning it to one was the only way to file it. The
-- 0027 rule that every shared row names a branch goes; the subject rule (0050) stays, so a
-- shared task is still always filed under a department's subject.
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_location_or_personal_check";
