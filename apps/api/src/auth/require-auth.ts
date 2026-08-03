import type { Role } from '@burgers/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { type Principal, extractBearerToken } from './principal.js'
import type { SessionService } from './sessions.js'

// The one authentication pre-handler every protected route shares (ADR-0007). It resolves the
// bearer to a fresh principal on the request and lets the handler read who the caller is and
// nothing else about identity; any failure — no header, a malformed value, an expired/invalid
// session — is one generic 401 that never distinguishes the cases. The validated bearer is
// stashed alongside the principal so a handler that must act on the session itself (logout)
// reaches the exact token this pre-handler already parsed rather than re-parsing it.
declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal
    sessionToken?: string
  }
}

// One generic unauthorized envelope, so a caller cannot tell a missing token from an expired or
// otherwise invalid one. `forbidden` is the flat shape the role guard sends for an admitted
// session whose role the endpoint does not allow.
const UNAUTHORIZED = { error: 'unauthorized' } as const
const FORBIDDEN = { error: 'forbidden' } as const

// Build the pre-handler bound to a session service. Reused by every route module (auth and the
// assistant threads) so authentication is resolved one way in one place — the principal read
// fresh from the session lookup on every request, never a cached or client-supplied claim.
export function createRequireAuth(
  sessionService: SessionService,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization)
    if (!token) {
      await reply.code(401).send(UNAUTHORIZED)
      return
    }
    const principal = await sessionService.validate(token)
    if (!principal) {
      await reply.code(401).send(UNAUTHORIZED)
      return
    }
    request.principal = principal
    request.sessionToken = token
  }
}

// Build a tier-one coarse role guard (ADR-0007): gate a whole endpoint by role. Runs after
// requireAuth, so the principal is already resolved on the request; a role outside the allowed
// set is one flat 403. Shared so the auth provisioning surface and the assistant resync endpoint
// gate by role the one same way. It reads only the resolved principal, so it needs no
// session service of its own.
export function createRequireRole(
  ...allowed: Role[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const principal = request.principal as Principal
    if (!allowed.includes(principal.role)) {
      await reply.code(403).send(FORBIDDEN)
    }
  }
}
