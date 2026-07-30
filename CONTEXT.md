# Burgers Bar Staff App

A staff-facing app for the Burgers Bar restaurant chain: a shared task board (todo)
and an AI ops-assistant chatbot, used by staff across multiple restaurant locations.

## Language

### Roles

**Admin**:
A chain/HQ-level user with full access across all locations. Manages users everywhere
(invites anyone, sets roles including other managers and admins, sets a user's location,
deactivates users) and can do anything a manager can at any location.
_Avoid_: Owner, superuser.

**Manager**:
A user scoped to a single location who runs that location's task board — creates,
assigns, edits, and deletes its tasks — and can invite employees to their own location.
Cannot create managers or admins, and cannot act on other locations.
_Avoid_: Supervisor, lead, team_member.

**Employee**:
A user scoped to a single location who carries out work. Views and completes the tasks
assigned to them; cannot create tasks or provision users.
_Avoid_: Staff member, worker, developer, assignee (assignee is a role *on a task*, not a user role).

### Core concepts

**Location**:
A single restaurant branch of the chain. The tenant/scope boundary: users and tasks
belong to a location. (One shared workspace overall, with `location` as an attribute —
not per-location tenants.) In v1 a user belongs to exactly one location.
_Avoid_: Branch, store, workspace, tenant.

**Task**:
A single unit of work on a location's board (the product's "todo"). Created by a manager
or admin, carries a status (not_started / in_progress / done) and a priority
(low / normal / high), and is a shared item — it has one status even when several people
are assigned.
_Avoid_: Agency task, todo item, ticket.

**Assignee**:
A user placed on a task's assignee set, responsible for completing it. A task can have
several assignees, all sharing the one status. Distinct from the task's creator. Assignees
must belong to the task's own location.
_Avoid_: Owner (of a task), developer.

**Backlog**:
A task with no assignee yet (empty assignee set). Visible only to managers and admins
until someone is assigned; employees never see unassigned tasks.
_Avoid_: Pool, unclaimed, up-for-grabs.
