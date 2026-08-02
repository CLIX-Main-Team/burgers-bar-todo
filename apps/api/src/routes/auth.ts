import {
  type Role,
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  createInviteRequestSchema,
  errorResponseSchema,
  logoutResponseSchema,
  principalResponseSchema,
  signInRequestSchema,
  signInResponseSchema,
  userIdParamsSchema,
  userListResponseSchema,
  userSummarySchema,
} from '@burgers/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccountService } from '../auth/account-service.js'
import type { AuthService } from '../auth/auth-service.js'
import type { InviteService } from '../auth/invite-service.js'
import { type Principal, extractBearerToken } from '../auth/principal.js'
import type { UserListScope, UserRow } from '../auth/repository.js'
import type { SessionService } from '../auth/sessions.js'

// The auth middleware attaches the resolved principal here; handlers behind
// requireAuth read it and nothing else about identity (ADR-0007). The validated
// bearer is stashed alongside it so a handler that must act on the session itself
// (logout) reaches the exact token requireAuth already parsed, rather than re-parsing.
declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal
    sessionToken?: string
  }
}

export interface AuthRouteDeps {
  authService: AuthService
  sessionService: SessionService
  inviteService: InviteService
  accountService: AccountService
  // The scoped user list (ADR-0007 tier two): the one read the provisioning surface
  // needs, passed as a narrow function rather than the whole repository.
  listUsers(scope: UserListScope): Promise<UserRow[]>
}

// One generic shape for every authentication failure, so a caller cannot tell a
// missing token from an expired one, or a wrong password from an unknown email.
const UNAUTHORIZED = { error: 'unauthorized' } as const
const INVALID_CREDENTIALS = { error: 'invalid_credentials' } as const
// The provisioning-surface failures. `forbidden` is a role/Location the principal may
// not create; `invalid_request` is a malformed create for the principal's own remit;
// `conflict` is an email already taken; `invalid_token` is any bad/expired/used accept
// token — one shape so a bad token never reveals which of those it was.
const FORBIDDEN = { error: 'forbidden' } as const
const INVALID_REQUEST = { error: 'invalid_request' } as const
const CONFLICT = { error: 'conflict' } as const
const INVALID_TOKEN = { error: 'invalid_token' } as const
// The status endpoints (deactivate/reactivate) name their target by id; `not_found` is
// any target that is not in the state the operation applies to — an unknown id, or a user
// who is not active (deactivate) / not deactivated (reactivate). One shape for all of them.
const NOT_FOUND = { error: 'not_found' } as const

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007). Any failure — no header, a
  // malformed value, an expired/invalid session — is one generic 401.
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = extractBearerToken(request.headers.authorization)
    if (!token) {
      await reply.code(401).send(UNAUTHORIZED)
      return
    }
    const principal = await deps.sessionService.validate(token)
    if (!principal) {
      await reply.code(401).send(UNAUTHORIZED)
      return
    }
    request.principal = principal
    request.sessionToken = token
  }

  // Tier-one coarse role guard (ADR-0007): gate a whole endpoint by role before its
  // handler runs. Runs after requireAuth, so the principal is already resolved; a role
  // outside the set is one flat 403. Provisioning endpoints admit only admin and manager.
  const requireRole =
    (...allowed: Role[]) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const principal = request.principal as Principal
      if (!allowed.includes(principal.role)) {
        await reply.code(403).send(FORBIDDEN)
      }
    }

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

  // Create an invite (#31, stories 3-8). Tier-one guard admits only admin and manager;
  // the service then enforces, from the principal, what role and Location this inviter
  // may bake in (ADR-0007) — never trusting the body's role/Location. On success the
  // pending user is returned and a one-time-link email has gone out.
  typed.post(
    '/invites',
    {
      preHandler: [requireAuth, requireRole('admin', 'manager')],
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

  // The scoped user list (TC-INV-09): an admin sees every user, a manager only their own
  // Location. The scope is derived from the principal in the data-access layer, never
  // from a query parameter. Provisioning surface, so admin/manager only.
  typed.get(
    '/users',
    {
      preHandler: [requireAuth, requireRole('admin', 'manager')],
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

  // Deactivate a user (#33, story 31). Admin only — cutting access is an admin power, so
  // the tier-one guard admits admin alone, not manager. Access is gone immediately: the
  // service flips the status and revokes every session the user holds, and because the
  // principal is read fresh each request (ADR-0007), a surviving in-flight session is
  // refused on its next call regardless. The record is retained (status deactivated, not
  // deleted) so historical references still resolve. A target that is not an active user
  // is one flat 404 that reveals nothing more.
  typed.post(
    '/users/:id/deactivate',
    {
      preHandler: [requireAuth, requireRole('admin')],
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
      const user = await deps.accountService.deactivate(request.params.id)
      if (!user) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(user)
    },
  )

  // Reactivate a user (#33, story 32). Admin only, as deactivate is. Restores sign-in with
  // the user's existing password — no re-provisioning — because only a previously-active,
  // deactivated account is ever restored (the service guards on the deactivated status).
  // A target that is not a deactivated user is one flat 404.
  typed.post(
    '/users/:id/reactivate',
    {
      preHandler: [requireAuth, requireRole('admin')],
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
      const user = await deps.accountService.reactivate(request.params.id)
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
}
