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
A single restaurant branch of the chain. The tenant/scope boundary: users and tasks
belong to a location. (One shared workspace overall, with `location` as an attribute —
not per-location tenants.) In v1 a user belongs to exactly one location. Carries a human
name that need not be unique. Created and renamed by an Admin — a chain-wide act, never a
Manager's — and never deleted in v1, so the users and tasks that reference it always
resolve. No Location is seeded at deploy; the first Admin creates the first branch.
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
