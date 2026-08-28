# Project checklist step owners

A project's checklist line can be handed to the people the project already reaches, the way a
task's checklist line can. Owner ask, 2026-08-28.

## Why this reverses a written decision

`projectChecklistItemSchema` says today: *"No assignee, no due date, no priority — those belong to
a board task, and a checklist that grew them would just be a second, worse task board."* That
reasoning held while a project checklist was a plan somebody read. It stopped holding once a
branch-opening project carried forty steps across a shift: the list is the work, and a list of
work with nobody's name on it is a list nobody owns.

What the original decision was protecting against is still protected. A step gains an OWNER and
nothing else. No due date, no priority, no status beyond the tick it already had. The checklist
does not become a board, because a board is those other three things.

## Who is assignable

Exactly the people the project already reaches, and never anybody else. Three clauses, all of
them ANDed:

1. **Role** — the person's role is named on the project, or is one of the two the branch picker
   names implicitly (`super_admin`, `admin`; see `ALWAYS_INVOLVED_ROLES`).
2. **Place** — the project is chain-wide, or the person's branch is one the project names. A
   branch-less HQ role is reached by a chain-wide project and by no other, which is the same rule
   `projectScopePredicate` already applies to a branch-less principal.
3. **Reach** — the person is somebody the acting principal may already see, per the existing
   `users.view` scope.

Clauses 1 and 2 are `projectScopePredicate` read forwards: instead of "which projects does this
person see", "which people see this project". Deriving both from one idea is the point — a stored
list of participants would drift from the scope predicate the first time a project changed branch,
and then the app would hold two different answers to who is on a project.

Clause 3 is the owner's call (2026-08-28). A branch admin opening a chain-wide project sees their
own branch's involved people, not the chain's. Two admins therefore open the same chain-wide
project and see different name lists, and only a chain-level role can hand a step across branches.
That is the same shape as every other scope rule in the app: a branch admin answers for a place.

Because the pool is exactly the involved set, an assignment can never create work its owner cannot
find. There is no visibility hole to plug and no notification to send about a project somebody
cannot open.

## Where it lives

### Data

`project_checklist_item_assignees (item_id, user_id, created_at)`, primary key on the pair, a
mirror of `task_checklist_item_assignees`. A join table rather than a column for the same reason
that one is: the answer to "who is on this" is a set, and a set in a column is a set you cannot
join, index or constrain.

Cascade from the item. NOT from the user — a user is deactivated, never deleted, so that FK is a
plain reference and a removed row would be referential corruption.

`projectChecklistItemSchema` grows `assignees: { id, displayName }[]`, ordered by display name so
two clients render one stack the same way.

### Reads

`GET /projects/:id/assignable` returns the candidate set above. A dedicated endpoint rather than
client-side filtering of `GET /users`, for two reasons:

- The client does not hold every user, so it cannot narrow a chain-wide project to a branch admin's
  own branch. Only the server can, and ADR-0007 says the server is the authority anyway.
- `GET /users` is gated on `page.users`. A role holding `projects.assign` without the People page
  would otherwise be shown a picker it could not fill.

`projectSummarySchema` grows `myOpenSteps: number` — steps on that project assigned to the
requesting user and not yet ticked. Counted server-side in the list query. The grid must not have
to fetch every project's checklist to draw a badge.

### Writes

`POST /projects/:id/checklist/:itemId/assignees`, body `{ userIds: string[] }`, replacing the set
wholesale. It answers with the whole project plus its checklist, like every other checklist route,
because a write here can move the project's phase and returning the item alone would leave the
client guessing.

The service re-derives the candidate set and refuses any id outside it. The picker showing only
valid choices is a courtesy; this check is the rule.

## Permissions

A new capability, `projects.assign`: *hand a project checklist step to somebody the project
reaches*. It appears on the Access page under the Projects group (`CAPABILITY_PAGE` → `page.projects`),
so the owner can widen it without a deploy.

Defaults mirror `projects.manage` exactly — on for `super_admin`, `ceo`, `chain_manager`, the seven
department managers and `admin`; off for `office_manager`, `hq_secretary`, `bookkeeper`, `manager`,
`employee`, `driver`, `field_ops`. Assigning is authoring: deciding who does what is the same act
as deciding what the steps are.

`projects.checklist` is untouched. Ticking stays open to everyone the project reaches, including
the people who can be assigned but cannot assign.

## The picker

The trigger is the task page's, unchanged: an avatar stack when the step has owners, a dashed
empty seat when it does not. Small and quiet, because a step is a line in a list and a full
labelled picker per line would turn a five-step checklist into five forms.

The menu is new. A filter field at the top, names grouped under branch headings. A chain-level role
opening a chain-wide project can be looking at forty-six branches' worth of people, and the task
page's flat scroll list does not survive that. A single-branch project shows one group and reads
exactly as the task page does today.

Branch-less HQ people group under a heading of their own rather than under a blank.

The task page keeps its own picker this round. Unifying the two is a separate job and not one to
do while the board is untouched.

## The badge

A project card shows the app's existing red counter badge when `myOpenSteps > 0`, in the card's
top-right beside the chevron. Tick a step and the number drops; tick the last and the badge goes.

Deliberately an OPEN count, not an unseen count. The Tasks tab badge counts assignments newer than
a last-seen marker, which needs that marker and answers "what is new". This one answers "what is
still mine to do", which is what a checklist is about, and needs no marker at all.

The badge is a non-interactive `<span>` under the card's full-card link overlay, so it never
competes with the card's own click target.

## Pruning

When a project's roles or branches are edited so that an assigned person falls out of the involved
set, their assignments on that project are deleted in the same transaction as the update.

The alternative is a ghost: somebody's avatar sitting on a step of a project they can no longer
open, which is worse than losing the assignment, because it reads as work that is somebody's when
it is nobody's. The task form already behaves this way — switching a task's branch clears its
picked assignees.

## Testing

- **Unit (shared)** — the candidate predicate: chain-wide vs named branches, a branch-less HQ role
  against both, the two always-involved admin roles, a deactivated user excluded.
- **Unit (api)** — pruning drops exactly the people who fell out and nobody else.
- **API integration** — `/assignable` narrows for a branch admin on a chain-wide project; the write
  refuses an id outside the set; the write refuses a principal without `projects.assign`; the
  response carries the whole project.
- **Web unit** — `myOpenSteps` drives the badge on and off; the picker filters and groups.
- **e2e** — assign a step, see the card badge, tick the step, watch the badge decrement.

## Out of scope

- A badge on the Projects nav item summing across projects. The card was the ask; the rollup is a
  follow-up.
- Due date or priority on a step. Assignee alone, for the reason at the top of this document.
- Unifying the project picker and the task picker.
