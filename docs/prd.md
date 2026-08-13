# Burgers Bar Staff App — Product Requirements

A staff-facing app for the Burgers Bar restaurant chain: a shared task board (the todo)
and an in-app AI ops-assistant, used by staff on their phones across the chain's locations.
Version 1, deliberately minimal.

This document is the product requirements for v1. It records what we are building and why,
at a level a location manager can read and approve. The decisions behind it are traceable to
the decision tickets and the architecture decision records in docs/adr/; the domain vocabulary
it uses is defined in CONTEXT.md.

## Problem and goal

Staff at each Burgers Bar location need one simple place, on the phone they already carry, to
see the work that has to happen on the floor and to get quick answers about their tasks and
the chain's procedures. Today that lives in people's heads, on paper, and in chat.

The goal is a single app where a staff member logs in and is taken straight to their tasks,
with an AI assistant one tap away. It is mobile-first, works in Hebrew and English, and is
branded as Burgers Bar. It borrows exactly two ideas from the existing Clix CRM — a task
board and a chatbot — and nothing else.

## Users

There are three kinds of user. Most people are employees; a handful are managers; very few
are admins.

- Admin — a chain or head-office user, not tied to one location. Manages users everywhere,
  can act on any location's board, and is the only role that can create managers or other
  admins. In practice this is the franchise owner or operations lead.
- Manager — runs a single location. Owns that location's task board and can bring on the
  employees who work there. Cannot touch other locations or create managers.
- Employee — floor staff at a single location. Does the tasks assigned to them and uses the
  assistant. Cannot create tasks or add users.

## Scope

In scope for v1:

- A shared task board per location — the todo — with the roles and permissions below.
- An in-app AI ops-assistant that answers a staff member's questions about their own tasks
  and the chain's procedures and policies.
- Invite-based login and onboarding.
- Hebrew and English throughout, mobile-first, Burgers Bar branding.

Explicitly not in scope — see Non-goals for the full list — the rest of the Clix CRM
(clients, projects, leads, invoices, dashboards), and building or deploying the app itself.
This document is the PRD, not the product.

## The task board (todo)

A task is one unit of work on a location's board. It is created by a manager or admin, can be
assigned to one or several people, and carries a single shared status that everyone assigned
sees — there is no per-person completion. A task with no one assigned yet is a backlog item,
visible only to managers and admins.

Each task record carries:

- Identity and place — an id, the location it belongs to, and who created it.
- Assignees — the set of users responsible for it. Empty means backlog. Every assignee must
  belong to the task's own location.
- Content — a title and a free-text description (staff write these in whatever language they
  speak; task content is never auto-translated).
- Status — one of not started, in progress, or done. One status per task, shared across
  assignees.
- Priority — one of low, normal, or high.
- Scheduling — an optional due date, and a completed-at timestamp that the system fills in
  when the task moves to done.
- Ordering and timestamps — a position for arranging the board, plus created and updated
  times.

Locations are the scope boundary: users and tasks belong to a location, and a location is
just a named branch of the chain. In v1 a user belongs to exactly one location. (This is one
shared workspace with a location attribute, not separate tenants per branch.)

## The assistant (chatbot)

The assistant answers questions in seconds with a single, direct in-app AI call — no external
automation, no waiting on a callback (ADR-0003). It is available to every role. A staff
member can hold several private conversations with it.

The pieces:

- Thread — one private conversation between a user and the assistant. It belongs to its author
  and is visible to no one else, not even managers or admins. A user may keep several, and can
  delete their own. Threads are auto-titled.
- Message — one turn in a thread, either the user's prompt or the assistant's reply. Nothing
  else writes messages: the browser can only read a user's own threads, and every message is
  written by the API's trusted server side, so the assistant's voice cannot be forged and a
  user cannot inject a fake turn (ADR-0003, ADR-0007).
- Knowledge doc — one of the chain's procedures or policies (for example, the closing
  checklist). These are authored by staff in a shared Google Drive folder and synced into the
  app's local cache; the assistant reads the cache, never Drive live, so a slow Drive never
  slows an answer (ADR-0004). Knowledge is chain-wide in v1, with room in the model for
  per-location docs later. The cache is indexed for retrieval: docs are split into chunks and
  matched to each question by meaning (embeddings), bilingually, so the relevant pieces are
  what ground an answer (ADR-0025 — superseding v1's use-the-docs-directly posture, which the
  corpus outgrew).

Two things keep the assistant safe. First, what it can retrieve to ground an answer is capped
at what the asking user is already allowed to see — an employee's own assigned tasks, a
manager's own-location board, an admin's cross-location view — so it can never become a way
around the permissions below. Second, it does not invent: if there is no procedure for
something, it says so rather than making one up, and it attributes what it draws on. The one
exception is small talk (owner decision, 2026-08): a greeting gets a warm greeting back and an
offer to help, but any actual question outside the knowledge base and the person's tasks is
declined — the assistant names what it covers, phrased naturally in its own words, rather than
answering from outside knowledge. When the material covers only part of a question it answers
the covered part and says plainly what is missing (ADR-0025) — partial help over a blanket
decline.

## Permissions

Access follows the three roles. Stated as what each role may do:

- Admin — everything, everywhere. Full task create, assign, edit, and delete on any location's
  board. Full user management across the chain: invite anyone, set any role and location
  (including minting managers and admins), and deactivate users. Has private assistant threads
  like everyone else.
- Manager — everything on their own location, nothing on others. Create, assign, edit, and
  delete tasks on their location's board, and see that location's backlog. Invite employees to
  their own location. Cannot create managers or admins, and cannot see or act on other
  locations. Has private assistant threads.
- Employee — narrow and own-scoped. Sees and updates only the tasks assigned to them, and may
  change only a task's status, nothing else. Never sees backlog or unassigned work. Cannot
  create tasks or add users. Has private assistant threads.

Enforcement lives in the API layer — role guards at the routes plus mandatory location and
assignee scoping in the data-access layer — not Postgres row-level security or Next server
actions (ADR-0007). Two notes carried from the architecture decisions, because they are easy
to get wrong: an employee's status change goes through a dedicated API path that writes only
the status, not a broad write that would let them rewrite the rest of a task (ADR-0002,
ADR-0007); and all assistant writes go through the API's assistant service for the same reason
(ADR-0003, ADR-0007).

## Login and onboarding

The app is invite-only — there is no public signup. The first admin is created once when the
app is set up; everyone else joins by invitation (ADR-0005).

- Getting in — an admin or manager sends an invite. An admin can invite anyone to any location
  in any role; a manager can invite only employees, and only to their own location. The
  inviter fills in the person's name, role, and location when sending it; the recipient cannot
  change any of those.
- Accepting — the invite is a one-time link that opens a single screen: set your password.
  That screen offers a Hebrew/English toggle, and the choice becomes the new user's language
  preference (changeable later). Login afterward is email and password. A forgot-password reset
  is available.
- What the manager sees — an invited person appears in the user list right away as pending, so
  the manager can see who has not accepted yet, resend, or revoke. Invites are single-use and
  expire after about a week.
- After login — the user lands on their task board, scoped to their role (an employee sees
  their tasks, a manager sees their location, an admin sees across locations). A bottom tab bar
  switches between Tasks and the Assistant; profile and settings sit behind an avatar in the
  header.
- Leaving — an admin can deactivate a user, which blocks login and ends their session but keeps
  the record, so past tasks and history still show a real name. A deactivated user can be
  reactivated. Their open tasks are not reassigned automatically; a manager reassigns as needed.

The user record therefore carries: an id, email, display name, role, location (except admins,
who are chain-wide), a status of invited, active, or deactivated, a preferred language of
Hebrew or English, and the timestamps — plus the invite details (its token, expiry, and who
sent it).

## Localization and branding

The app is mobile-first: staff use it on phones on the floor, and every screen is designed for
that first.

It is bilingual, Hebrew and English. The interface chrome is translated, and the layout
direction switches with the language — right-to-left for Hebrew, left-to-right for English.
User-written content, such as task titles and descriptions, is free text and is never
translated. Each user has a language preference; the login, accept, and reset screens carry
the language toggle too, since they are used before a user's preference exists.

Branding is Burgers Bar. The monochrome "(B)" mark is the app icon — on the dark canvas, the same
tile whether the app arrives as the Android build or as an installed web app — and, drawn exactly
as the browser-tab icon is, the mark in both shells' headers; the wordmark sits beside it. The palette is
the brand site's own — the interaction blue (#297DE1), one chocolate brown (#5F4A32), warm cream,
and the tan-to-chocolate signature gradient (2026-08 revision) — over neutral canvases in both
themes, with brown and cream carried as brand accents rather than grounds (2026-08-11 revision).
It is set in full by the design system (docs/design-system/). The brand assets live in
assets/brand.

## Notifications

In-app only in v1. The Tasks tab carries a count badge showing tasks assigned to the user that
they have not yet seen, backed by a simple per-user last-seen marker. There are no push or
email notifications in v1 — staff see their work by opening the app.

## Non-goals

Called out so they are not assumed:

- Building, implementing, or deploying the app. This document is the PRD; hosting and
  infrastructure are a later, separate decision.
- Every other Clix CRM surface — clients, projects, leads, invoices, milestones, and the CRM
  dashboards. Only the task board and the assistant are borrowed.
- Push and email notifications. In-app badge only (see above).
- The source CRM's long-running webhook chatbot path, and any AI streaming or embeddings/vector
  search, in v1 (ADR-0003, ADR-0004).
- More than one location per user, and per-location knowledge docs — the data model leaves room
  for both, but v1 ships one location per user and a chain-wide knowledge base.
- Public self-signup and self-service role or location changes — provisioning is invite-only
  and controlled by admins and managers (ADR-0005).
