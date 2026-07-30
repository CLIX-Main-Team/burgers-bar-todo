# Permission enforcement in the API layer: role guards plus mandatory scope predicates

Status: accepted. Supersedes the enforcement-mechanism assumptions of ADR-0001 (Postgres
row-level security as the role-enforcement mechanism), ADR-0002 (a status-only Next server
action) and ADR-0003 (a service-role server action plus read-only RLS for chat). The rules
those ADRs fix — the three-role model and its authority split, the employee status-only
write, the manager location scope, the manager/admin-only backlog, the no-forged-agent-turn
chat boundary, and the invite-side role/location constraints — are unchanged in intent. Only
the mechanism moves: from RLS-in-Postgres plus Next server actions to the dedicated API
(ADR-0006's three-tier shift). This is the outcome of the grilling on ticket #15 and is
security-sensitive under rule 5.

## Context

ADR-0001 through ADR-0005 assumed the source CRM's shape: a Next.js app enforcing access in
two places at once — Postgres row-level security gating which rows a client could read or
write, and service-role server actions for the writes RLS could not express (column-scoped
and forgery-sensitive ones). The architecture is now a client-rendered SPA talking to a
dedicated Fastify API over Postgres/Drizzle (ADR-0006, ticket #13). There is no Next server
action to run privileged writes and no PostgREST-style browser-to-database path for RLS to
guard. The enforcement has to live somewhere in the new shape; this ADR fixes where and how.

## Decision

Enforce permissions in the API layer, as two tiers over one per-request principal. Do not
re-enforce in the database.

The principal. The auth middleware (ADR-0006) resolves the bearer token to its session row on
every request and produces a principal — user id, role, location id, and status — read fresh
from that lookup, and attaches it to the request context. Because it is read per request, a
location reassignment or a deactivation is honoured on the very next request without any
cached claim going stale. Every authorization decision below reads from this principal and
nothing else; a request never trusts a role, a location, or a user id sent by the client.

Tier one — coarse role guards at the route. Thin middleware gates whole endpoints by role
before any handler runs: task create, assign, edit and delete require manager or admin; user
provisioning requires manager or admin; the employee status-only path requires an
authenticated user. This answers "may this role touch this endpoint at all" and nothing
finer.

Tier two — mandatory scope predicates in the data-access layer. Row and column scope is
data-dependent, not role-only, so it lives with the queries. The task data-access module
exposes only principal-parametrized methods; there is no unscoped "get all tasks" or "update
task" that a caller could reach without a principal. A single central helper derives the scope
predicate from the principal:

- Admin — no location filter (chain-wide).
- Manager — location id equals the principal's location.
- Employee — the task's assignee set contains the principal's user id.

Every task read and write is built with this predicate. Two consequences fall out for free and
are therefore not separate mechanisms: an employee cannot see the backlog, because the
assignee-membership predicate structurally excludes tasks with an empty assignee set; and a
manager cannot touch another location's board, because the predicate is applied to writes as
well as reads.

The employee status-only rule (replacing ADR-0002's server action). Two distinct write paths,
not one path with a field allow-list bolted on. A full-update method is gated to manager and
admin and scoped to their location. A separate updateTaskStatus method verifies the caller is
an assignee of the task (or a manager/admin of its location) and writes only the status column,
with completed-at maintained alongside. Employees are routed solely to updateTaskStatus and
never reach a code path that can write title, priority, assignees, or due date. Column scope is
thus a property of which method exists for whom, not a runtime filter that a refactor could
quietly widen.

The assignee-location invariant. On assign, the service validates that every assignee belongs
to the task's own location before the write, so cross-location assignment cannot be smuggled
through the assign path.

Chat writes (replacing ADR-0003's service-role server action plus read-only RLS). Message
writes happen only inside the API's assistant service; there is no client message-insert path,
so an agent turn cannot be forged from the browser and a user cannot inject a fake turn. Thread
reads are scoped to the author's own user id — a thread is visible to no one else, not even a
manager or admin. Retrieval that grounds an answer is capped at the principal's own visibility
(the same task predicate above, plus the chain-wide knowledge cache), so the assistant cannot
become a way around the three-role model.

Invite-side constraints (unchanged in intent, now an API guard). The invite service enforces
that a manager may create only employee invites for their own location and an admin may invite
any role to any location, deriving the acting role and location from the principal — the same
constraint ADR-0001 and ADR-0005 fixed, now checked in the API rather than assumed by an RLS
policy.

## Considered options

A dedicated policy/authorization layer — policy objects, or a library such as CASL or oso, as
a single declarative source of authorization truth — was considered and rejected as more
machinery than this surface needs. The rule set is small, closed, and unlikely to churn (three
roles, one location dimension, one column-scoped write, one privacy boundary); a policy engine
buys expressiveness we would not use and adds a dependency and a layer of indirection over what
two thin tiers state directly. This is the operating-standard right-sizing call: a small
client, delivery-first, and an authorization surface a reader can hold in their head. If the
role or scoping model later grows several dimensions, revisit this.

Keeping Postgres RLS as a second enforcement plane in the non-Supabase database (setting a
per-request role on the connection and letting RLS gate rows underneath the API) was considered
and rejected. It cannot express the column-scoped employee write — the exact gap ADR-0002 was
written to cover — so the API would still own that path, leaving RLS as a partial backstop
rather than the enforcement. Worse, it splits the source of authorization truth across two
places that must be kept in lockstep; a scope rule changed in the API but not in a policy, or
the reverse, is a silent divergence. One enforcement plane in the API, with the database a
trusted store behind it, keeps the logic in one auditable place.

## Consequences

The API is now the sole enforcement plane and the database is a trusted store behind it, with
no RLS backstop. This raises the stakes on the data-access discipline: every task and thread
query must go through the scoped methods, and a raw, unscoped Drizzle query against the tasks
or threads tables is the failure mode to guard against — the direct analogue of ADR-0002's
warning not to widen the employee write. Do not add an unscoped repository method, and do not
let an employee-reachable route call the full-update path.

The status-only split (ADR-0002) and the no-forged-agent-turn chat split (ADR-0003) are
preserved exactly, in mechanism-updated form: two write paths for the task status, and
API-only message writes. Do not "simplify" either into a single permissive path — that
reintroduces the column-write and turn-forgery holes those ADRs closed.

The enforcement layer — the role guards, the scope-predicate helper, the two task-write paths,
the assignee-location check, and the chat write/read scoping — is security-critical code, and
every change to it triggers rule 5 human review before merge.

The permission-enforcement mechanism named in older documents is superseded here. The flowchart
source docs and the delivered diagram still label the enforcement points as row-level access
rules and server actions; the source text is corrected in the same change as this ADR, and the
diagram redraw is tracked separately (ticket under map #10) because it re-renders a client
deliverable.
