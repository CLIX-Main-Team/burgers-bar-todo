import { z } from 'zod'

// The SPA-to-API contract: zod schemas shared by both sides (engineering-design),
// wired into Fastify via fastify-type-provider-zod. Each auth operation's schema
// lands with its slice; this file grows as the surface does.

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

// The three roles and the account lifecycle statuses (ADR-0001, ADR-0005), shared
// so the SPA and API name them identically. locationId is null for an admin.
export const roleSchema = z.enum(['admin', 'manager', 'employee'])
export type Role = z.infer<typeof roleSchema>

export const userStatusSchema = z.enum(['invited', 'active', 'deactivated'])
export type UserStatus = z.infer<typeof userStatusSchema>

// The two interface languages (ADR-0005). A user picks one at accept; it drives the
// SPA's language and direction (he = RTL, en = LTR) once they are signed in.
export const preferredLanguageSchema = z.enum(['he', 'en'])
export type PreferredLanguage = z.infer<typeof preferredLanguageSchema>

// The one password minimum-length rule the SPA and API both enforce (auth plan,
// shared contracts), applied wherever a user sets a password — invite accept and, later,
// reset-consume. Sign-in deliberately does not use it (an existing password of any age
// must still authenticate); it guards password *creation* only.
export const PASSWORD_MIN_LENGTH = 8
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH)

// Sign-in: email plus password in, an opaque bearer session token out (ADR-0006).
// Email is trimmed here and matched case-insensitively server-side; the password is
// only required to be present at this endpoint — the minimum-length rule that guards
// password creation lives on the accept/reset schemas, not on sign-in.
export const signInRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})
export type SignInRequest = z.infer<typeof signInRequestSchema>

export const signInResponseSchema = z.object({
  token: z.string(),
})
export type SignInResponse = z.infer<typeof signInResponseSchema>

// One generic error envelope for the auth failures, so every non-revealing response
// (a wrong password, an unknown email, a missing or bad bearer) shares one shape and
// leaks nothing through its structure.
export const errorResponseSchema = z.object({
  error: z.string(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>

// The current principal, read fresh from the session lookup on every request
// (ADR-0007). This is exactly what the auth middleware attaches and what the
// current-principal endpoint reports: who the caller is, right now.
export const principalResponseSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
  locationId: z.string().uuid().nullable(),
  status: userStatusSchema,
})
export type PrincipalResponse = z.infer<typeof principalResponseSchema>

// Logout and logout-all end sessions server-side and carry nothing back but an
// acknowledgement; the client's job on success is to drop its stored bearer and
// return to login (ui-flow, session touchpoints). Both endpoints share this shape.
export const logoutResponseSchema = z.object({
  status: z.literal('ok'),
})
export type LogoutResponse = z.infer<typeof logoutResponseSchema>

// Create an invite (#31, stories 3-8). The inviter supplies the invitee's email,
// display name, role, and Location. What the acting principal is *allowed* to bake in
// is enforced server-side from the principal, never trusted from this body (ADR-0007):
// an admin may invite any role to any Location; a manager may create only employee
// invites for their own Location. locationId is null for an admin invitee and required
// for a manager/employee — that cross-field rule is checked in the service against the
// principal, so it is not expressed here.
export const createInviteRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1),
  role: roleSchema,
  locationId: z.string().uuid().nullish(),
})
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>

// Resend and revoke address a single pending invite by the pending user's id in the
// path (#32, stories 9-10). There is no separate invite id — an outstanding invite is
// its Invited users row plus its live token — so the pending user's id is the handle.
// Which invites the caller may act on is enforced server-side from the principal
// (ADR-0007), never from this path: an admin may act on any invite, a manager only on an
// employee invite for their own Location.
export const inviteIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type InviteIdParams = z.infer<typeof inviteIdParamsSchema>

// Resend and revoke change server-side state — a fresh token mailed, or the pending user
// removed — and carry nothing back but an acknowledgement (ui-flow, invite touchpoints).
// The refreshed list the SPA shows afterwards comes from a follow-up GET /users.
export const inviteActionResponseSchema = z.object({
  status: z.literal('ok'),
})
export type InviteActionResponse = z.infer<typeof inviteActionResponseSchema>

// The manager/admin "resync now" acknowledgement (#89, ADR-0014). The endpoint reconciles the
// knowledge cache against Drive and answers with this only once the pass has completed, so a
// just-changed doc is answerable by the time the caller sees it. The refreshed cache is observed
// through the assistant's own grounding reads, so the body carries nothing but the acknowledgement.
export const resyncKnowledgeResponseSchema = z.object({
  status: z.literal('ok'),
})
export type ResyncKnowledgeResponse = z.infer<typeof resyncKnowledgeResponseSchema>

// A user as the provisioning API reports it — the pending invitee right after create,
// and any user in the inviter's scoped list. No credential material ever appears here;
// this is the outward view of a users row (stories 6, 8). preferredLanguage is included
// so the language chosen at accept is observable afterwards (TC-ACC-02).
export const userSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  locationId: z.string().uuid().nullable(),
  // The resolved Location name that rides alongside the id, so a roster prints `Downtown`,
  // never the raw uuid (people build, mockup #179). It is null exactly when locationId is —
  // a chain-wide admin — which the UI presents as "Chain-wide"; it is never a stale or
  // orphaned name, since it is resolved from the locations row on every read.
  locationName: z.string().nullable(),
  status: userStatusSchema,
  preferredLanguage: preferredLanguageSchema,
})
export type UserSummary = z.infer<typeof userSummarySchema>

// The scoped user list (TC-INV-09): an admin sees every user, a manager sees only their
// own Location's users. The scope is derived from the principal in the data-access layer
// (ADR-0007), never from a query parameter.
export const userListResponseSchema = z.object({
  users: z.array(userSummarySchema),
})
export type UserListResponse = z.infer<typeof userListResponseSchema>

// The user id carried in the path for the admin-only status operations — deactivate and
// reactivate (#33, stories 31-32). Validating it as a uuid at the route keeps a malformed
// id from ever reaching the data-access layer. The target user is named in the path; the
// acting admin is the principal behind the bearer, never a body field.
export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type UserIdParams = z.infer<typeof userIdParamsSchema>

// Accept an invite and set a password (#31, stories 13-15). Reached pre-auth by opening
// the one-time link, which carries the raw token; the recipient sets a password (the
// shared minimum-length rule applies) and picks a language. Role and Location are baked
// into the invite and are immutable by the recipient, so they are absent here.
export const acceptInviteRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
  preferredLanguage: preferredLanguageSchema,
})
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>

// Accept signs the recipient straight in with no separate login step (story 15): the
// response carries a session bearer, the same shape sign-in returns.
export const acceptInviteResponseSchema = z.object({
  token: z.string(),
})
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>

// Request a password reset (#34, stories 26-30). Only the email is supplied; everything
// about which accounts exist is hidden. Email is trimmed here and matched
// case-insensitively server-side, the same as sign-in.
export const requestPasswordResetRequestSchema = z.object({
  email: z.string().trim().email(),
})
export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetRequestSchema>

// One generic confirmation for every reset request — matched or not, active or not, and
// whether or not it was rate-limited (stories 27, 30). The response reveals nothing about
// which emails have accounts, so the SPA shows the same "if the address is registered, a
// link is on its way" message for all of them (ui-flow, reset request). Consume shares
// this same acknowledgement shape.
export const resetAcknowledgementSchema = z.object({
  status: z.literal('ok'),
})
export type ResetAcknowledgement = z.infer<typeof resetAcknowledgementSchema>

// Consume a reset and set a new password (#34, stories 26, 28, 29, 36). Reached pre-auth by
// opening the one-time link, which carries the raw reset token; the user sets a new
// password (the shared minimum-length rule applies). No session comes back — completing a
// reset revokes every one of the user's existing sessions (story 29), so the user is sent
// to login to sign in afresh (ui-flow, reset consume). Success is a bare acknowledgement.
export const consumePasswordResetRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})
export type ConsumePasswordResetRequest = z.infer<typeof consumePasswordResetRequestSchema>

// --- Assistant threads and messages (#90) ---

// A turn's author (ADR-0003): exactly `user` and `agent`, matching the message_role pg enum.
// There is no `error` role — a failed answer is a transient inline retry, not a thread row.
// The client never supplies a role: the create path fixes 'user' server-side and the answer
// path (a later slice) is the only writer of an 'agent' turn (ADR-0007), so this schema types
// what a reader may *see*, never what a writer may name.
export const messageRoleSchema = z.enum(['user', 'agent'])
export type MessageRole = z.infer<typeof messageRoleSchema>

// Start a thread (#90). The client supplies only the first user message; the server owns
// everything else — it derives the title, fixes the turn's role to 'user', and stamps the
// owner from the principal (never from the body). The shared trim + min(1) rule means an
// empty or whitespace-only message is refused before the handler runs, so a thread always
// has a non-empty first turn to derive a title from.
export const createThreadRequestSchema = z.object({
  content: z.string().trim().min(1),
})
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>

// Post a question to an existing thread and get a grounded answer back (#91, ADR-0003). Like thread
// creation, the client supplies only the text — never a role — so an `agent` turn cannot be forged
// from the browser (ADR-0003); the same trim + min(1) rule refuses an empty question before the
// handler runs. The response is the thread's updated detail (the new user turn and the agent reply),
// so the SPA re-renders the conversation from the one response, and a model failure returns no body
// to persist (a transient inline retry, not a thread row).
export const postThreadMessageRequestSchema = z.object({
  content: z.string().trim().min(1),
})
export type PostThreadMessageRequest = z.infer<typeof postThreadMessageRequestSchema>

// One knowledge doc an assistant answer drew on (#227): the ingested doc's id and its title, the
// pair the attribution chips render. Sources are named only for an `agent` turn grounded in the
// knowledge corpus — a task-grounded answer or a refusal carries none — and every id here is a real
// ingested doc the answer path matched the model's citation against, never a free-text title.
export const messageSourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
})
export type MessageSource = z.infer<typeof messageSourceSchema>

// One turn as the API reports it (#90): the author role, the text, and the created timestamp
// (ISO 8601) that orders a thread's history. No thread_id or internal ids beyond the row id —
// a message is only ever read inside its already-authorised thread. `sources` (#227) is present
// only on an `agent` turn: the knowledge docs that grounded the reply, an empty array when the
// answer was task-grounded or a refusal, and absent on a `user` turn (which cites nothing).
export const threadMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  sources: z.array(messageSourceSchema).optional(),
})
export type ThreadMessage = z.infer<typeof threadMessageSchema>

// A thread as the list reports it (#90): the auto-derived title and the timestamps (ISO 8601)
// the SPA orders on. The owner is not carried — every thread in a response is the caller's own
// (author-scoped reads, ADR-0007), so a user_id field would be redundant and is omitted.
export const threadSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ThreadSummary = z.infer<typeof threadSummarySchema>

// The caller's own threads, most-recently-active first (#90). The scope is derived from the
// principal in the data-access layer, never from a query parameter (ADR-0007).
export const threadListResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
})
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>

// A single thread opened with its full turn history in created order (#90): the summary plus
// its messages. Returned by both create (the new thread with its first user turn) and open.
export const threadDetailSchema = threadSummarySchema.extend({
  messages: z.array(threadMessageSchema),
})
export type ThreadDetail = z.infer<typeof threadDetailSchema>

// The thread id carried in the path when opening one (#90). Validating it as a uuid at the
// route keeps a malformed id from reaching the data-access layer; the acting user is the
// principal behind the bearer, and a thread that is not theirs is a non-enumerating 404.
export const threadIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type ThreadIdParams = z.infer<typeof threadIdParamsSchema>

// Delete acknowledgement (#257, PRD: a user "can delete their own" threads): the thread and its
// messages are gone — a hard delete, matching the PRD's privacy stance (a thread is private even
// from admins, so "deleted" must not mean "retained but hidden") — and nothing of it comes back
// but this bare ok. The same shape as the task delete ack.
export const threadDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type ThreadDeleteResponse = z.infer<typeof threadDeleteResponseSchema>

// --- Task board (the todo, #129; Slice A read, #131) ---

// A task's closed sets (CONTEXT: Task), named identically SPA-side and API-side so the board
// can render each value and the read-side priority sort can order on it. status is the single
// shared state every assignee sees (no per-person completion); priority drives the sort toggle.
export const taskStatusSchema = z.enum(['not_started', 'in_progress', 'done'])
export type TaskStatus = z.infer<typeof taskStatusSchema>

export const taskPrioritySchema = z.enum(['low', 'normal', 'high'])
export type TaskPriority = z.infer<typeof taskPrioritySchema>

// One assignee as the board reports it (CONTEXT: Assignee): the user id and the display name the
// board shows. No email, role, or status — the board renders who is on a task, not a user record,
// and the co-assignees a viewer sees are only ever people who share a task already in their scope.
export const taskAssigneeSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
})
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>

// One task as the scoped board read reports it (#131). Every field the board renders is here
// (story 9): title, description, status, priority, assignees, dueDate, completedAt. description is
// shown in the language it was authored in and is never auto-translated (story 10), so it is a
// plain string with no locale tag; it, dueDate, and completedAt are null when unset. Timestamps
// are ISO 8601 strings. locationId rides along so an admin's chain-wide board can group by branch.
// position is the shared per-location manual order the board opens to (story 11); the priority
// sort is a per-viewer client-side lens that never touches it.
export const taskSchema = z.object({
  id: z.string().uuid(),
  locationId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  position: z.number().int(),
  assignees: z.array(taskAssigneeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Task = z.infer<typeof taskSchema>

// The scoped board read (#131, ADR-0007). The scope predicate is derived from the principal in the
// data-access layer — an employee sees only their own assigned tasks, a manager their whole
// location including the backlog, an admin the chain — never from a role at the route or a query
// parameter, and there is no unscoped "all tasks" path. tasks arrive in the shared manual order
// (position, with a stable id tiebreak); the high→low priority sort is a client-side lens over
// this same list. lastSeenAt is this user's board last-seen marker as it stood *before* this read
// bumped it (null the first time they ever open the board): opening the board both advances the
// marker to now and reports where it was, so the trigger is observable through a follow-up read
// rather than a row peek (story 15). The Tasks-tab badge that consumes it belongs to #59.
export const taskBoardResponseSchema = z.object({
  tasks: z.array(taskSchema),
  lastSeenAt: z.string().nullable(),
})
export type TaskBoardResponse = z.infer<typeof taskBoardResponseSchema>

// One frame of the live board channel (#132, Slice A2, ADR-0015). The board updates in place over
// scope-filtered server-sent events: the server pushes a change only to subscribers whose read
// scope admits that task (the fan-out reuses the very predicate that gates reads), and the client
// patches its TanStack Query cache from the stream. Every board change in the write slices
// (B create/assign, C status, D reorder) is an upsert of a task that still exists, so a single
// self-describing kind — the current task as the subscriber is allowed to see it — covers the
// channel: the client replaces the task in its cache if present, else inserts it into the shared
// manual order. A task leaving a subscriber's scope (reassigned away) simply stops arriving; it is
// never announced, which is the same boundary the scoped read draws (a viewer never learns of a
// task that was never theirs).
export const taskBoardEventSchema = z.object({
  type: z.literal('task.upserted'),
  task: taskSchema,
})
export type TaskBoardEvent = z.infer<typeof taskBoardEventSchema>

// --- Task board writes (Slice B — create / edit / delete + assign, #133) ---

// The assignee set a write carries: a list of user ids. Empty is the backlog case (a task with no
// one on it) and is the default when the field is omitted, so "leave it unassigned" needs no
// explicit empty array. Every id must belong to the task's own location — the assignee-location
// invariant — but that cross-row rule is checked in the service against the users' real locations
// (ADR-0007), not expressible here, so this schema only shapes the ids, never who may be named.
const assigneeIdsSchema = z.array(z.string().uuid())

// Create a task on a location's board (#133, stories 24-30). Manager/admin only (tier-one role
// guard); an employee is refused at the route. The target location is resolved server-side from the
// acting principal, never trusted blindly from this body (ADR-0007): a manager's own location is
// used and naming another is refused, while an admin — who holds no location of their own — must
// name one here. priority defaults to normal and the assignee set to empty (the backlog); dueDate is
// an optional calendar deadline. description is the free-text note, shown in its authored language
// and never translated, so an empty note is sent as null rather than a blank string.
export const createTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullish(),
  priority: taskPrioritySchema.default('normal'),
  dueDate: z.string().datetime().nullish(),
  assigneeIds: assigneeIdsSchema.default([]),
  // Null/omitted for a manager (their own location is used); required for an admin, checked in the
  // service against the principal — an admin who names none is an invalid request.
  locationId: z.string().uuid().nullish(),
})
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>

// Edit a task through the full-update path (#133, stories 31-32; #134 adds status). Manager/admin
// only; this is the path an employee never reaches (their only write is the status-only path in
// Slice C). It replaces the editable fields wholesale — title, description, priority, due date, and
// the assignee set — so every field is required (nullable where the column is), and reassignment is
// just a new assignee set. Location is never here: a task never changes location in v1. status is
// the one optional field: a manager/admin may also move status through this full edit (story 43),
// but omitting it leaves the status exactly as it stands — so a Slice-B-shaped edit is unchanged and
// never silently resets status. An employee still cannot reach this path; their status write is the
// dedicated one below.
export const updateTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  priority: taskPrioritySchema,
  dueDate: z.string().datetime().nullable(),
  assigneeIds: assigneeIdsSchema,
  status: taskStatusSchema.optional(),
})
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>

// Change only a task's status (#134, Slice C, stories 37-40). The employee's sole write and their
// dedicated path: it carries the status and nothing else — no field allow-list to get wrong — so an
// assignee can move a task not_started ↔ in_progress ↔ done (any direction, a mis-tap is reversible)
// but can never rewrite its title, priority, assignees, or due date. The path has no tier-one role
// guard (an authenticated user reaches it), so who may act is the scope predicate alone: an employee
// only on their own assigned tasks, a manager on their location, an admin chain-wide. completed_at is
// not here — the DB trigger maintains it on entering/leaving done (ADR-0002), so no caller types it.
export const updateTaskStatusRequestSchema = z.object({
  status: taskStatusSchema,
})
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusRequestSchema>

// The task id carried in the path for the by-id writes — edit and delete (#133). Validating it as a
// uuid at the route keeps a malformed id from reaching the data-access layer; the acting principal
// is the bearer behind the request, and a task outside their write scope is one non-enumerating 404,
// never a confirmation the row exists on another location's board.
export const taskIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>

// Delete acknowledgement (#133, story 33): the task is gone, so nothing of it comes back but this
// bare ok. The acting client drops the card and the board read no longer carries it; other viewers
// see it leave on their next board read (a deletion is not relayed over the upsert-only live channel).
export const taskDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type TaskDeleteResponse = z.infer<typeof taskDeleteResponseSchema>

// --- Task board reorder (Slice D — manual drag-reorder, #135) ---

// Set a location's shared manual order (#135, stories 46-52). A manager or admin drags tasks into an
// order and this carries the result: the full ordered list of a *single* location's task ids, from
// which the server rewrites each task's `position` to its index — so `position` is the one canonical
// shared per-location order every viewer opens to, and this request is that order made explicit.
// Employees never reach here (tier-one role guard). locationId is null/omitted for a manager (their
// own location is used, and naming another is refused) and required for an admin (who holds none of
// their own and so must name the board they are arranging) — the same principal-resolved target the
// create path uses, never trusted blindly (ADR-0007). Every id must belong to that one location — the
// tasks-in-location invariant, the reorder twin of the assignee-location one — so a mixed-location
// list is rejected rather than silently reindexed. An empty list is a valid no-op.
export const reorderTasksRequestSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
  // Null/omitted for a manager (their own location is used); required for an admin, checked in the
  // service against the principal — an admin who names none is an invalid request.
  locationId: z.string().uuid().nullish(),
})
export type ReorderTasksRequest = z.infer<typeof reorderTasksRequestSchema>

// The reorder result (#135): the reordered location's tasks in the new shared order (position
// ascending, id the stable tiebreak), each as the acting caller sees them. The acting client can
// drop this straight into its board; other viewers converge through the live channel, which relays
// the same changed tasks. It carries no lastSeenAt — a reorder is a write, not the user opening the
// board, so it must not move the marker the badge dates from (unlike the board read).
export const reorderTasksResponseSchema = z.object({
  tasks: z.array(taskSchema),
})
export type ReorderTasksResponse = z.infer<typeof reorderTasksResponseSchema>

// --- Location management (Slice L1 — the locations API, #164) ---

// One Location as the admin surface reports it (CONTEXT: Location): its id and human name, nothing
// more. name-only in v1 (address/timezone/flags are additive later on the same table), and no
// timestamps a caller acts on — a Location is referenced everywhere by id, so the name is the only
// mutable, human-facing attribute. This is the outward view both UI consumers read: the invite
// picker and the task-form board list, retiring the "distinct locationIds from the people list" hack.
export const locationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})
export type Location = z.infer<typeof locationSchema>

// The authoritative Location list (#164), Admin-only (ADR-0007 — re-authorised server-side, never
// UI-gated). Ordered by name, and the single source both UI consumers repoint to. There is
// deliberately no scope parameter: an admin sees every Location, full stop, so the list is not
// derived from a query or a role at the route beyond the tier-one admin gate.
export const locationListResponseSchema = z.object({
  locations: z.array(locationSchema),
})
export type LocationListResponse = z.infer<typeof locationListResponseSchema>

// Create a Location from a name (#164). Admin-only. The trim + min(1) rule refuses an empty or
// whitespace-only name before the handler runs — the only server-side validation. There is
// deliberately NO uniqueness check: same-name branches are legitimate (real chains have them), so a
// duplicate is accepted here and the soft "already exists — create anyway?" warning is a UI concern
// in L2/L3, driven off the list read, not a rejection on this path.
export const createLocationRequestSchema = z.object({
  name: z.string().trim().min(1),
})
export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>

// Rename a Location (#164). Admin-only, addressing the Location by id in the path. The same trim +
// min(1) rule applies to the new name. Because everything references a Location by id, a rename
// ripples nowhere — no user or task row changes — so this is a pure one-column update.
export const updateLocationRequestSchema = z.object({
  name: z.string().trim().min(1),
})
export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>

// The Location id carried in the path for rename (#164). Validating it as a uuid at the route keeps
// a malformed id from reaching the data-access layer; a rename of an id that does not exist is a
// plain 404 (there is nothing location-scoped to hide here — the whole surface is admin-only).
export const locationIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type LocationIdParams = z.infer<typeof locationIdParamsSchema>
