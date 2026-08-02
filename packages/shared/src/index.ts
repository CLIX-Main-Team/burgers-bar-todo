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
