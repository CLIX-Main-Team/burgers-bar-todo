import {
  errorResponseSchema,
  logoutResponseSchema,
  principalResponseSchema,
  signInRequestSchema,
  signInResponseSchema,
} from '@burgers/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AuthService } from '../auth/auth-service.js'
import { type Principal, extractBearerToken } from '../auth/principal.js'
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
}

// One generic shape for every authentication failure, so a caller cannot tell a
// missing token from an expired one, or a wrong password from an unknown email.
const UNAUTHORIZED = { error: 'unauthorized' } as const
const INVALID_CREDENTIALS = { error: 'invalid_credentials' } as const

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
}
