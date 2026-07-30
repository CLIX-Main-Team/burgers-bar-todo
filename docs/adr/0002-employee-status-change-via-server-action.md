# Employee status changes go through a server action, not a permissive RLS UPDATE

An employee may change only a task's `status`, nothing else, and only on tasks assigned to
them (they appear in `assignee_user_ids`). Postgres row-level security can gate which *rows*
an update sees but cannot restrict which *columns* an UPDATE touches. A permissive employee
UPDATE policy would therefore let an assignee rewrite `title`, `priority`, `assignee_user_ids`,
or `due_date` via raw PostgREST — not just the status.

Decision: employees get a **read-only RLS policy** (SELECT on rows where they are an assignee)
plus a **status-only server action** running with the service-role client, which validates
assignee membership and writes only `status` (with `completed_at` maintained by the DB trigger).
Managers and admins act through the normal RLS-gated client for their full read/write scope.
This mirrors the source CRM's 0107 self-SELECT policy and its `updateMyAgencyTaskStatus` action.

Consequence: do not "simplify" the employee write path into an RLS UPDATE policy — doing so
silently grants column-level write over the whole task and breaks the manager/employee split.
