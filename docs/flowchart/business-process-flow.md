# Business Process Flow — Burgers Bar Staff App

The ordered account of what happens in the business, step by step, and who is responsible
for each step. This is the process layer of the Flowchart deliverable. It is derived from
docs/prd.md and uses the vocabulary defined in CONTEXT.md exactly; it is the authority on the
diagram's process content, and the diagram is redrawn from it rather than edited directly.

Terms are used as CONTEXT.md defines them: Admin, Manager, Employee, User, Invite, User status,
Location, Task, Assignee, Backlog, Assistant, Thread, Message, Knowledge Base, Knowledge Doc.
"App" below names the application's trusted server side — the API server (its route guards and
service layer) and the database — as one participant, since the PRD treats those enforcement
points as a single system boundary. Enforcement lives in the API layer, not in the database
(ADR-0007).

There are three business processes. Onboarding brings a User into the app; the task lifecycle
is the work the app exists to coordinate; the assistant conversation runs in parallel and is
open to every role. A fourth, supporting process — knowledge authoring — feeds the assistant.

## Onboarding a user

1. Seed the first Admin. Once, when the app is set up, a single Admin account is created. This
   is the only User not created by an Invite (ADR-0005).

2. An Admin or Manager sends an Invite. The inviter fills in the new person's name, role, and
   Location. An Admin may invite anyone to any Location in any role, including minting Managers
   and other Admins; a Manager may invite only Employees, and only to their own Location. The
   recipient cannot change the name, role, or Location.

3. The App creates a pending User and a one-time link. A User record is written with User status
   invited, and a single-use Invite link is issued that expires after about a week. The pending
   User appears in the inviter's user list right away, so the inviter can see who has not
   accepted, resend, or revoke.

4. The invited person opens the link and sets a password. The link opens one screen — set your
   password — carrying a Hebrew/English toggle; the choice becomes the User's preferred language.

5. The App activates the User. The App validates the token (single-use, unexpired), stores the
   password, and moves User status from invited to active. The link cannot be used again.

6. The User logs in. Login afterward is email and password; a forgot-password reset is available.
   The App routes the User to their Task board, scoped to their role.

## The task lifecycle

7. A Manager or Admin creates a Task. On a Location's board they write a title, a free-text
   description, and a priority, with an optional due date. A Task created with no Assignee is a
   Backlog item, visible only to Managers and Admins.

8. A Manager or Admin assigns the Task. One or more Assignees are placed on the Task; every
   Assignee must belong to the Task's own Location. Once assigned, the Task leaves Backlog and
   becomes visible to its Assignees. The Task carries one shared Status across all Assignees —
   there is no per-person completion.

9. An Assignee changes the Status. An Employee sees only the Tasks assigned to them and may
   change only the Status — not the title, description, priority, or Assignees. Status moves
   among not started, in progress, and done. (Managers and Admins may edit any field.)

10. The Task is completed. When Status becomes done, the App stamps the completed-at time. The
    Task is done.

11. An Admin deactivates a User when they leave. Deactivation blocks login and ends the session
    but keeps the record, so past Tasks still show a real name; the User can be reactivated. Open
    Tasks are not reassigned automatically — a Manager reassigns them as needed.

## The assistant conversation

Runs in parallel with the above and is available to every role. It does not depend on a User
having any Task.

12. A User opens a private Thread. Any User may hold several private Threads with the Assistant;
    a Thread belongs to its author and is visible to no one else, not even Managers or Admins.
    Threads are auto-titled, and a User may delete their own.

13. The User sends a Message. The prompt is one turn in the Thread, written with the User's role.

14. The Assistant gathers grounding within the User's scope. What may be retrieved to ground an
    answer is capped at what the asking User is already allowed to see — an Employee's own
    assigned Tasks, a Manager's own-Location board, an Admin's cross-Location view — together
    with the Knowledge Docs. The assistant can never become a way around the permissions.

15. The Assistant answers. A single, direct, synchronous AI call returns a grounded reply, stored
    as a Message with role agent (ADR-0003). The Assistant does not invent: with no procedure for
    something it says so rather than making one up, and it attributes what it drew on.

## Knowledge authoring (supporting)

Feeds step 14. It runs on its own cadence, independent of any single conversation.

16. Staff author Knowledge Docs in Google Drive. The chain's procedures and policies — for
    example the closing checklist — are written in a shared Google Drive folder. Knowledge is
    chain-wide in v1.

17. The App syncs Drive into a local cache. Knowledge Docs are mirrored from Drive into the App's
    local cache. The Assistant reads the cache only, never Drive live, so a slow Drive never slows
    an answer (ADR-0004).

## Diagram conventions (decisions recorded here per operating-standard rule 11)

Responsibility is shown by swimlanes, not by labelling each step with its actor. This choice was
made over per-step actor labels because the diagram has six participants and three interleaving
processes; a lane makes "who does what" readable at a glance and keeps the handoffs between actor
and App visible as arrows crossing lane boundaries. It is recorded here because a later reader
would otherwise silently reverse it.

The one combined flowchart is laid out as two stacked process bands, each a set of swimlanes with
time flowing left to right:

- Band 1, provisioning and the task lifecycle (steps 1–11), with lanes Admin, Manager, Employee,
  and App.
- Band 2, the assistant conversation and knowledge authoring (steps 12–17), with lanes User (any
  role), App, Assistant, and Google Drive.

The App system lane is drawn in both bands. This is deliberate: it is one system, repeated per
band so each process reads on its own without arrows threading the full height of the diagram. The
two bands are joined by a dashed connector from "route to Task board" (band 1) to "open a Thread"
(band 2), labelled to show the assistant runs in parallel and is open to any User at any time —
left-to-right is the order within a band, not a global clock. Knowledge authoring likewise runs on
its own cadence and is drawn as its own short lane sequence feeding the assistant's grounding step.

Admin and Manager are kept as separate lanes in band 1 even though they share steps 2, 7, and 8,
because their authority differs (an Admin acts chain-wide and mints Managers and Admins; a Manager
is confined to one Location and invites only Employees) and the difference is part of what the
diagram must show. A shared step is drawn once in the Admin lane with a small dashed note in the
Manager lane recording the Manager's narrower version, rather than duplicated as two boxes. The
band-2 person lane is labelled User (any role) because the assistant is open to every role and the
onboarding recipient is whatever role their Invite named; the common case, an Employee, is noted on
the step.

The data movements that ride these steps are specified in dfd.md; the arrows in the diagram carry
the data labels named there. Every step above appears in the diagram as a shape, and no shape
appears in the diagram that is not in this document or dfd.md.
