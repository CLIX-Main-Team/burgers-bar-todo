# Departments and task subjects

The chain gets departments. Every person is invited into one, and the shared task board is no
longer a flat pile: it opens on a department, shows that department's subjects as cards, and a
task lives inside a subject. Owner ask, 2026-09-20, from the client's list of seven departments.

## The ask, as decided

- Seven departments, given by the client: מנהלה, תפעול, רכש, שיווק, מוקד, כספים, שירות לקוחות.
  A fixed list in this update; nobody edits it in the app.
- A person belongs to at most one department. Everyone is asked on invite, the branch trio
  (admin, manager, employee) included, and the department can be changed on the edit-person
  dialog afterwards. The column is nullable, so today's rows stay valid and a person can exist
  with none.
- On the Tasks page the personal tab is untouched. The "All tasks" tab becomes department, then
  subject cards, then the tasks of one subject. A super admin sees every department and picks one;
  every other role lands straight in its own department. Both are Access page settings, not facts
  of the role.
- Every shared task sits in exactly one subject and keeps its branch. Personal tasks have no
  subject.
- Subjects are created, renamed and deleted by whoever holds the new capability, which is the
  super admin alone by default.
- The shared tasks already in the system are deleted by the migration (they are seeded test rows).
  Personal tasks are kept.

## Not in this update

Editing the department list in the app; more than one department per person; department-scoped
knowledge folders (parked earlier, the column this adds is what it will need); moving a personal
task into a subject; a subject that spans departments.

## Data

Migration 0050, one migration for the whole feature so the users tab and the tasks page never
race each other over the same tables. It is numbered 0050 with the stamp two days past main's
last: 0049 was held by an assistant PR while this was written (since closed), and the number
stayed once the users tab had branched from the pushed commit. The gap is harmless; the migrator
orders by stamp, not by number.

`departments`: `id uuid pk`, `slug text unique`, `name_he text`, `name_en text`,
`position smallint`, `created_at`. Seeded in the migration, in the client's order:

| position | slug | name_he | name_en |
|---|---|---|---|
| 1 | management | מנהלה | Management |
| 2 | operations | תפעול | Operations |
| 3 | procurement | רכש | Procurement |
| 4 | marketing | שיווק | Marketing |
| 5 | call_center | מוקד | Call center |
| 6 | finance | כספים | Finance |
| 7 | customer_service | שירות לקוחות | Customer service |

The knowledge documents already carry a text column called `department` (property, finance, hr,
operations, office, general): that is the assistant's filing of a document, a different concept
with a different vocabulary. It is not touched and nothing here reads it; the new table is the
only meaning of "department" for people and tasks.

`users.department_id uuid null references departments(id)`. No backfill: null means "not placed
yet", and the board fails closed for such a person (below) rather than guessing.

`task_subjects`: `id uuid pk`, `department_id uuid not null references departments(id)`,
`name text not null`, `description text null`, `created_by uuid not null references users(id)`,
`position integer not null default 0`, `created_at`, `updated_at`. A unique index on
`(department_id, lower(name))` so a department never holds two subjects that read the same.
Deletion is a hard delete, refused while any task still points at the subject: the subject row is
what the tasks hang from, and a cascade would silently take a department's work with it.

`tasks.subject_id uuid null references task_subjects(id)`, plus the check
`tasks_subject_or_personal_check`: `personal or subject_id is not null`. A task's department is
its subject's department, read through the join; there is no second column that could drift from
it. `location_id` stays exactly as it is, so the branch rule and the branch filter keep working
inside a subject. The migration runs `delete from tasks where not personal` before adding the
check, which takes assignees and checklist rows with it through the existing cascades.

## Access

Two entries in the Access page catalog, both under `page.tasks` for the cascade. The access-page
tab adds them to `packages/shared` (catalog, defaults, page mapping, both locales, the page row);
this feature only consumes them.

- Capability `tasks.manageSubjects`: create, rename, delete subjects. Default on for
  `super_admin` (locked, as every super admin capability is), off for every other role.
- View scope `tasks.departments`, choices `all` and `own`. Default `all` for `super_admin`,
  `own` for every other role. Written as a scope, not a boolean, so it renders beside the
  existing chain / branch / assigned control and the client can later hand `all` to the CEO
  without a code change.

The scope is applied inside `taskScopePredicate` (apps/api/src/task-board/scope.ts), the one
predicate every task read reuses. Shared work becomes: not personal, AND the existing horizon rule
(`dashboard.view`), AND the department rule:

- `all`: true.
- `own` with a department: `exists (select 1 from task_subjects s where s.id = tasks.subject_id
  and s.department_id = <principal.departmentId>)`.
- `own` without a department: false. Fails closed, the same choice the branch rule makes for a
  branch-held principal with no location.

Because it lives in the predicate, the dashboard's totals and the assistant's my_tasks tool
inherit the narrowing without their own changes. The dashboard consequence is deliberate: a
department head's numbers are their department's numbers.

The principal gains `departmentId` and `departmentName` (read with the session, like
`locationId` and `locationName`), so `/auth/me` tells the client where the viewer sits.

## API

- `GET /departments`: the seven rows, ordered by position, for any signed-in user. Feeds the
  invite picker and the chips.
- `GET /tasks/subjects?departmentId=`: the subjects of one department, each with `openCount`,
  `doneCount` and `assignees` (the distinct people holding an open task in it, first four plus an
  overflow count). Scoped: an `own` viewer receives their own department's subjects whatever id
  they pass; an `all` viewer may ask for any. Subjects are ordered by position, then name.
- `POST /tasks/subjects` `{ departmentId, name, description? }`, `PATCH /tasks/subjects/:id`
  `{ name?, description? }`, `DELETE /tasks/subjects/:id`: behind `requireCapability
  ('tasks.manageSubjects')`. A duplicate name in the department is a 409; a delete while tasks
  remain is a 409 carrying `{ taskCount }` so the dialog can say how many.
- `POST /tasks`: `subjectId` required unless `personal`. `PATCH /tasks/:id` accepts `subjectId`,
  which is how a task moves between subjects. Both refuse (404, not 403, so a subject id is never
  confirmed to a viewer who cannot see it) a subject outside the writer's department scope.
- The board read keeps its shape and its single live channel. Every task row gains `subjectId`,
  `subjectName`, `departmentId`, `departmentName` (null for personal). The page narrows to the open
  subject on the client, the same way the branch and person lenses already narrow.
- Invite (`POST /auth/invite`) accepts `departmentId` (uuid or null); the user list joins
  `departments` so each `UserSummary` carries `departmentId` and `departmentName` without a
  second request. Changing a placed person's department is a new admin route, `PATCH /users/:id`
  with `{ departmentId }` (a uuid or null, required: a body naming nothing has no honest
  answer), guarded by the admin roles and scoped like deactivate (a branch admin only within
  their own branch); the users tab wrote it on top of this branch's foundation commit, since it
  belongs to the edit-person dialog. A person cannot change their own
  department on `PATCH /auth/me`: it is an organisational fact, set by an admin.

Shared types in `packages/shared`: `Department` + `departmentSchema`, `TaskSubject` +
`taskSubjectSchema` (with the counts and assignee stack), the four new task fields, the two new
user fields, and the request schemas above. The people fixtures in apps/web and the e2e stream
stubs (outside typecheck, so they fail only at run time) are updated in the same change.

## Screens

Routes: `/tasks` (both scope tabs; the chosen department rides `?department=<slug>`), and
`/tasks/subjects/:subjectId` for one subject's board. Each level has a URL so refresh, back and a
pasted link land in the right place, as the projects page already does.

### Level 1: departments and subject cards (`/tasks`)

The two scope tabs stay exactly as they are; the personal tab is untouched.

Redrawn the same day in a design pass (owner review 2026-09-20; an index column and a share
bar were drawn first and sent back, the chips and the rest kept). This section describes what
ships.

With scope `all`, a row of department chips sits under the scope tabs: seven chips, each
carrying the department's open-task count, wrapping on desktop and scrolling sideways on a
phone with the chosen chip scrolled into view. The chosen chip is written to the URL and
remembered per device, so a super admin comes back to the department they last worked in. With
scope `own`, there are no chips. A viewer with no department sees an empty state saying they
are not placed in a department yet and an admin can set one.

Under the chips, the ledger head: the department's name as the section heading, a one-line sum
under it ("4 subjects · 11 open · 6 done", pluralised in both languages), and the "New subject"
button at the inline end for a holder of `tasks.manageSubjects`.

Under the head, a grid of subject cards (one column, two from `sm`, three from `xl`). A card is a link to its subject (stretched title, so avatar tooltips and
the menu stay clickable), and reads, top to bottom:

- a small colour swatch beside the name: the subject's colour is its slot in the department
  walked through the eight person tones (`position % 8`), not a hash of the name, so eight
  siblings never share one;
- the name (sized to its text, so a name in the other script stays beside its swatch), and the
  description line under it when there is one, both `dir="auto"`;
- the open count at heading size with "open" beside it, then "· N done" in caption ink, and at
  the inline end the avatar stack of the people holding open tasks in it with a `+N` overflow;
- the ticket rail (done tiles in the subject's colour, open tiles muted).

A card with zero tasks shows an empty rail and no stack; it is not hidden, because a freshly
created subject has to be findable. A department with no subjects shows an empty state, and for
a holder of `tasks.manageSubjects` that state carries the create button.

The "New subject" button opens a small dialog titled with the department ("New subject in
Operations"): name, description. Each card gets a menu with rename (same dialog, prefilled) and
delete. Delete confirms; a 409 turns the confirm into the message "Move or finish its N tasks
first", never a silent failure.

The facet filters (branch, role, person) and the search do not appear at this level: they narrow
tasks, and this level shows subjects. The search box here filters subject names instead.

### Level 2: one subject (`/tasks/subjects/:subjectId`)

A header: a back link naming the department, the subject name, its description, and the counts.
Under it, today's toolbar and today's board, unchanged: board/list toggle, branch, role and person
facets, search, drag to reorder, the status kanban below `lg`. The only lens added is the subject
itself.

"New task" here opens the task form with the subject prefilled. The task form gains a subject
field, a select grouped by department: every department for an `all` writer, only their own for an
`own` writer. Editing it moves the task, which is what makes "delete only when empty" workable.
The field is absent on the personal task dialog.

A subject id the viewer cannot see (wrong department, deleted) renders the same not-found state
the projects detail uses, with a link back to `/tasks`.

### Phone

Chips scroll in one row under the scope tabs, the ledger head follows, cards stack in one
column; the subject screen is today's phone board with the back link on top. Nothing new is
desktop-only.

### Language

Every new string lands in both locales in messages.ts, under `tasks.*` for the page and
`people.*` for the picker labels the users tab adds. Department names come from the row
(`nameHe` / `nameEn`) by UI language, not from the message catalog.

## Ownership and order

1. Access-page tab: the catalog PR (`tasks.manageSubjects`, `tasks.departments`), off main. This
   branch is rebased onto it so the typed keys compile.
2. This tab, branch `feat/task-departments`: migration 0050, schema, shared types, the routes
   above, the scope predicate, the page. Merges only on the owner's explicit go.
3. Users tab, off this branch's foundation commit and rebased onto main once 2 merges: department
   picker on the invite form, the `PATCH /users/:id` admin route and the department field on the
   edit-person dialog, department in the roster.
4. Assistant tab (the one that claimed it): department in people_directory, subject and
   department on my_tasks rows.

## Testing

API: the scope predicate for `all`, `own` with a department, `own` without one (empty), and
personal rows unaffected by any of them; subject create with a duplicate name (409); delete with
tasks (409 with count) and without; task create without a subject (400), with a subject outside
the writer's department (404), and a move by PATCH; the user list carrying `departmentName`;
the migration applying on a database holding personal and shared rows.

Web: the lens that narrows the board to a subject; the subject card (counts, stack overflow,
empty subject); the chips writing the URL; the `own` empty state; the task form refusing to
submit a shared task without a subject. Existing fixtures gain the new fields. The e2e stream
stubs are updated by hand since typecheck does not reach them.

How to verify by hand: sign in as the super admin, create a subject in כספים, create a task in
it, open the task and move it to a subject in שיווק, then sign in as an invited finance user and
confirm they land in כספים and cannot open the שיווק subject by URL.
