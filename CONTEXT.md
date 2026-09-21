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

### Accounts and onboarding

**User**:
A person's account in the app. Carries a role, a location (except an admin, who is
cross-location), a display name set by whoever invited them, a preferred language, and a
status. The app is invite-only: there is no self-signup, and the first admin is seeded at
deploy time.
_Avoid_: Account, member, profile.

**Invite**:
A one-time, single-use link that provisions a new User. Created by an admin (any role, any
location) or a manager (employees to their own location only); the target's role and location
are baked into it and cannot be changed by the recipient, who only sets a password on accept.
Expires after a short window and can be resent or revoked.
_Avoid_: Signup, registration, sign-up.

**User status**:
Where a User sits in their lifecycle. Invited — the record exists from an unaccepted invite
and cannot log in yet. Active — the invite was accepted and the User can log in. Deactivated
— an admin has blocked login and revoked the session, but the record is retained so past task
and thread references still resolve; it can be reactivated.
_Avoid_: For deactivated — deleted, removed (the record is kept, not destroyed).

### Core concepts

**Location**:
A single restaurant branch of the chain, or the one company headquarters (ADR-0029). The
tenant/scope boundary: users and tasks belong to a location. (One shared workspace overall,
with `location` as an attribute — not per-location tenants.) A user belongs to exactly one
location, the owner alone to none. Carries a human name that need not be unique and a kind,
branch or headquarters. A branch is created and renamed by an Admin — a chain-wide act,
never a Manager's — and deleted only while nothing is on it. The headquarters is seeded by
migration, never created in the app, and never deleted.
_Avoid_: Branch, store, workspace, tenant.

**Headquarters**:
The one Location that is not a restaurant: where the owner and the office roles work from.
"Not literally a branch, but a branch for this system" (the client, 2026-09-21): staffed and
read like one, with no branch number, no branch admin (the owner runs it) and no place in any
count or ranking of branches. Every role but a branch admin and the owner may sit there.
_Avoid_: Head branch, main branch, chain-wide (that is the owner alone).

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

**Department**:
One of the chain's seven working groups (management, operations, procurement, marketing,
call center, finance, customer service). A user sits in at most one, set on invite and
changed by an admin; the list itself is fixed. On the shared task board a department is
the first thing chosen: a chain-horizon viewer picks one, everyone else is already in
theirs. Unrelated to a Knowledge Doc's filing, which the assistant also calls a department.
_Avoid_: Team, division, unit.

**Subject**:
The card a department's shared tasks are filed under. Belongs to exactly one department;
every shared task sits in exactly one subject, and a personal task in none. Created,
renamed and deleted by whoever holds the subjects capability (the super admin by default),
and deleted only once no task remains in it.
_Avoid_: Category, topic, folder, project.

### Chatbot

**Assistant**:
The in-app AI ops-assistant. Answers a staff member's questions about their own tasks
and the chain's procedures and policies, grounded only on what that member is already
allowed to see. Available to every role.
_Avoid_: Bot, marketing agent, agent (agent is a message role, not the product).

**Thread**:
A single private conversation between one user and the Assistant. Owned by its author and
visible to no one else (not even managers or admins); a user may keep several.
_Avoid_: Conversation, channel, session, chat.

**Message**:
One turn in a thread — either a user prompt (role user) or an Assistant reply (role
agent). Distinct from a Task's own concepts.
_Avoid_: Turn, entry, post.

**Knowledge Base**:
The chain's procedures and policies that the Assistant draws on, authored by staff in a
shared Google Drive folder and mirrored into the app. Chain-wide in v1.
_Avoid_: KB, corpus, wiki.

**Knowledge Doc**:
A single document within the Knowledge Base — one procedure or policy (e.g. the closing
checklist).
_Avoid_: Article, page, entry.

**Full Load**:
The first ever sync of the Knowledge Base (ADR-0021): with no cursor yet, the app lists every
document currently in the Drive folder and ingests it, filling an already-populated folder that
the changes feed will never report. Runs once; keyed on "no cursor exists", not "zero docs".
_Avoid_: Backfill, full sync, reindex, import.

**Incremental Reconcile**:
Every sync after the Full Load (ADR-0021): the app walks Drive's changes feed from the persisted
cursor and applies only what changed since. Driven by the boot fire and the ~20-minute interval.
_Avoid_: Delta sync, refresh, poll, update.
