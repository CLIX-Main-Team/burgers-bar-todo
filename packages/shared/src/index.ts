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

// One turn as the API reports it (#90): the author role, the text, and the created timestamp
// (ISO 8601) that orders a thread's history. No thread_id or internal ids beyond the row id —
// a message is only ever read inside its already-authorised thread.
export const threadMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
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
