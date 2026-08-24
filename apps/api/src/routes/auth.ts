import {
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  consumePasswordResetRequestSchema,
  createInviteRequestSchema,
  errorResponseSchema,
  inviteActionResponseSchema,
  inviteIdParamsSchema,
  logoutResponseSchema,
  principalResponseSchema,
  requestPasswordResetRequestSchema,
  resetAcknowledgementSchema,
  signInRequestSchema,
  signInResponseSchema,
  userIdParamsSchema,
  userListResponseSchema,
  userSummarySchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccountService } from '../auth/account-service.js'
import type { AuthService } from '../auth/auth-service.js'
import type { InviteService } from '../auth/invite-service.js'
import type { Principal } from '../auth/principal.js'
import type { UserListScope, UserRow } from '../auth/repository.js'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { ResetService } from '../auth/reset-service.js'
import type { SessionService } from '../auth/sessions.js'

// The FastifyRequest principal/sessionToken augmentation and the shared requireAuth/requireRole
// pre-handlers live in auth/require-auth.js, so every route module resolves authentication and
// role-gating the one same way (ADR-0007).

export interface AuthRouteDeps {
  authService: AuthService
  sessionService: SessionService
  inviteService: InviteService
  accountService: AccountService
  resetService: ResetService
  // The scoped user list (ADR-0007 tier two): the one read the provisioning surface
  // needs, passed as a narrow function rather than the whole repository.
  listUsers(scope: UserListScope): Promise<UserRow[]>
}

// One generic shape for every authentication failure, so a caller cannot tell a
// wrong password from an unknown email. (The missing/expired-bearer 401 shape lives with
// the shared requireAuth pre-handler in auth/require-auth.js.)
const INVALID_CREDENTIALS = { error: 'invalid_credentials' } as const
// The provisioning-surface failures. `forbidden` is a role/Location the principal may
// not create; `invalid_request` is a malformed create for the principal's own remit;
// `conflict` is an email already taken; `invalid_token` is any bad/expired/used accept
// token — one shape so a bad token never reveals which of those it was.
const FORBIDDEN = { error: 'forbidden' } as const
const INVALID_REQUEST = { error: 'invalid_request' } as const
const CONFLICT = { error: 'conflict' } as const
const INVALID_TOKEN = { error: 'invalid_token' } as const
// `not_found` is the one non-enumerating 404 the by-id endpoints share. For the status
// endpoints (deactivate/reactivate) it is any target not in the state the operation
// applies to — an unknown id, a user who is not active (deactivate) / not deactivated
// (reactivate), or a user outside the caller's AccountActionScope. For resend/revoke it is
// any case where there is no pending invite the caller may act on — unknown id,
// no-longer-invited user, or an invite outside the caller's remit — so acting on an id
// never confirms whether the row exists or sits in another Location.
const NOT_FOUND = { error: 'not_found' } as const

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler the
  // assistant thread and resync routes use. Any failure — no header, a malformed value, an
  // expired/invalid session — is one generic 401.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The tier-one coarse role guard (ADR-0007), shared from auth/require-auth.js so the assistant
  // resync endpoint gates by role the one same way. Provisioning endpoints admit only admin and
  // manager; a role outside the set is one flat 403.
  const requireRole = createRequireRole

  // Sign in with email + password; a session bearer on success, one generic 401 on
  // any bad-credential case (story 18). Email is matched case-insensitively downstream.
  typed.post(
    '/auth/sign-in',
    {
      schema: {
        body: signInRequestSchema,
        response: { 200: signInResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body
      const token = await deps.authService.signIn(email, password)
      if (!token) {
        return reply.code(401).send(INVALID_CREDENTIALS)
      }
      // Sign-in no longer touches Drive: the knowledge cache is kept current by the server's
      // boot fire and 20-minute interval, not by login (ADR-0021 reverses ADR-0014's login trigger).
      return reply.code(200).send({ token })
    },
  )

  // The current principal, read fresh from the session lookup on this very request.
  typed.get(
    '/auth/me',
    {
      preHandler: requireAuth,
      schema: { response: { 200: principalResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      // requireAuth guarantees principal is set before this handler runs.
      const principal = request.principal as Principal
      return reply.code(200).send(principal)
    },
  )

  // Log out this device: end the current session immediately (story 24). requireAuth
  // has already validated the bearer, so the same header names the exact session to
  // delete; revocation is a row delete and the token's next request is refused.
  typed.post(
    '/auth/logout',
    {
      preHandler: requireAuth,
      schema: { response: { 200: logoutResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      // requireAuth guarantees the validated token is stashed before this handler runs.
      const token = request.sessionToken as string
      await deps.sessionService.revoke(token)
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Log out everywhere: cut every session this user holds at once, for the lost- or
  // stolen-device case (story 25). The user id comes from the resolved principal, so
  // one device can only ever revoke its own account's sessions, never another's.
  typed.post(
    '/auth/logout-all',
    {
      preHandler: requireAuth,
      schema: { response: { 200: logoutResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      await deps.sessionService.revokeAllForUser(principal.userId)
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Create an invite (#31, stories 3-8). Tier-one guard admits the admin roles and manager;
  // the service then enforces, from the principal, what role and Location this inviter
  // may bake in (ADR-0007) — never trusting the body's role/Location. On success the
  // pending user is returned and a one-time-link email has gone out.
  typed.post(
    '/invites',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin', 'manager')],
      schema: {
        body: createInviteRequestSchema,
        response: {
          201: userSummarySchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.inviteService.createInvite(principal, request.body)
      if (!result.ok) {
        switch (result.reason) {
          case 'forbidden':
            return reply.code(403).send(FORBIDDEN)
          case 'conflict':
            return reply.code(409).send(CONFLICT)
          default:
            return reply.code(400).send(INVALID_REQUEST)
        }
      }
      return reply.code(201).send(result.user)
    },
  )

  // Resend an invite (#32, story 9): mint a fresh one-time link and invalidate the prior
  // one, so the old link stops working and the new one accepts. Same tier-one guard as
  // create; the service then enforces, from the principal, which pending invite this
  // caller may touch (ADR-0007) — an id outside that remit is one non-enumerating 404,
  // indistinguishable from an unknown or no-longer-pending invite.
  typed.post(
    '/invites/:id/resend',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin', 'manager')],
      schema: {
        params: inviteIdParamsSchema,
        response: {
          200: inviteActionResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const outcome = await deps.inviteService.resendInvite(principal, request.params.id)
      if (outcome === 'not_found') {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Revoke an invite (#32, story 10): invalidate the token and remove the pending user,
  // so the link is rejected afterward and the user is gone from the list. Same guards and
  // the same non-enumerating 404 as resend for any invite the caller may not act on.
  typed.post(
    '/invites/:id/revoke',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin', 'manager')],
      schema: {
        params: inviteIdParamsSchema,
        response: {
          200: inviteActionResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const outcome = await deps.inviteService.revokeInvite(principal, request.params.id)
      if (outcome === 'not_found') {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // The scoped user list (TC-INV-09): a super_admin sees every user; a branch admin, a
  // manager and an employee each see only their own Location. The scope is derived from
  // the principal in the data-access layer, never from a query parameter. Provisioning
  // surface, so the admin roles and manager only.
  typed.get(
    '/users',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin', 'manager')],
      schema: {
        response: {
          200: userListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const users = await deps.listUsers({ role: principal.role, locationId: principal.locationId })
      return reply.code(200).send({ users })
    },
  )

  // Deactivate a user (#33, story 31). Admin-tier only — cutting access is an admin power,
  // so the tier-one guard admits super_admin and admin, not manager. The AccountActionScope
  // built here from the principal (never from the request) is what actually authorises the
  // target: the repository bakes it into the query's WHERE (accountActionScopePredicate,
  // ADR-0007), so a super_admin reaches any row while a branch admin reaches only a row at
  // their own Location and never one whose role is admin — a peer admin, even at their own
  // branch, is out of reach. Access is gone immediately: the service flips the status and
  // revokes every session the user holds, and because the principal is read fresh each
  // request (ADR-0007), a surviving in-flight session is refused on its next call
  // regardless. The record is retained (status deactivated, not deleted) so historical
  // references still resolve. A target that is not an active user this principal may reach
  // is one flat 404 that reveals nothing more.
  typed.post(
    '/users/:id/deactivate',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin')],
      schema: {
        params: userIdParamsSchema,
        response: {
          200: userSummarySchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const user = await deps.accountService.deactivate(request.params.id, {
        role: principal.role,
        locationId: principal.locationId,
      })
      if (!user) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(user)
    },
  )

  // Reactivate a user (#33, story 32). Admin-tier only and scoped the same way deactivate
  // is (AccountActionScope, built from the principal). Restores sign-in with the user's
  // existing password — no re-provisioning — because only a previously-active, deactivated
  // account is ever restored (the service guards on the deactivated status). A target that
  // is not a deactivated user this principal may reach is one flat 404.
  typed.post(
    '/users/:id/reactivate',
    {
      preHandler: [requireAuth, requireRole('super_admin', 'admin')],
      schema: {
        params: userIdParamsSchema,
        response: {
          200: userSummarySchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const user = await deps.accountService.reactivate(request.params.id, {
        role: principal.role,
        locationId: principal.locationId,
      })
      if (!user) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(user)
    },
  )

  // Accept an invite and set a password (#31, stories 13-15). Pre-auth: the one-time link
  // carries the token, and success signs the recipient straight in with a session bearer.
  // The password minimum-length rule is enforced by the body schema, so a too-short
  // password is refused before the handler runs and the token is never consumed
  // (TC-ACC-03). Any bad/expired/used token is one flat 400 that leaks nothing.
  typed.post(
    '/auth/accept',
    {
      schema: {
        body: acceptInviteRequestSchema,
        response: { 200: acceptInviteResponseSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const token = await deps.inviteService.acceptInvite(request.body)
      if (!token) {
        return reply.code(400).send(INVALID_TOKEN)
      }
      return reply.code(200).send({ token })
    },
  )

  // Request a password reset (#34, stories 26-30). Pre-auth: a forgotten password is
  // recovered without being signed in. The response is one generic acknowledgement for
  // every case — matched or not, active or not, throttled or not (stories 27, 30) — so it
  // reveals nothing about which emails have accounts. The service does any real work
  // (mint token, send mail) only for an active, non-throttled email. The per-IP half of
  // the rate limit reads request.ip, resolved from the connection, never from the body.
  typed.post(
    '/auth/reset-request',
    {
      schema: {
        body: requestPasswordResetRequestSchema,
        response: { 200: resetAcknowledgementSchema },
      },
    },
    async (request, reply) => {
      await deps.resetService.requestReset({ email: request.body.email, ip: request.ip })
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Consume a reset and set a new password (#34, stories 26, 28, 29, 36). Pre-auth: the
  // one-time link carries the token. The password minimum-length rule is enforced by the
  // body schema, so a too-short password is refused before the handler runs and the token
  // is never consumed (TC-RESET-06). Any bad/expired/used token is one flat 400 that leaks
  // nothing. No session is returned — completing the reset revokes every one of the user's
  // sessions, and the user signs in afresh (story 29, ui-flow).
  typed.post(
    '/auth/reset-consume',
    {
      schema: {
        body: consumePasswordResetRequestSchema,
        response: { 200: resetAcknowledgementSchema, 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const ok = await deps.resetService.consumeReset(request.body.token, request.body.password)
      if (!ok) {
        return reply.code(400).send(INVALID_TOKEN)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
