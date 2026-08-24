import type { CapabilityKey, Role } from '@burgers/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AccessService } from '../access/service.js'
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

// Options that widen where the bearer may be presented. The default (everywhere) is the header
// alone; the SSE board channel opts into a query fallback because the browser's EventSource cannot
// set an Authorization header, and its native reconnect (ADR-0015) reissues the same GET URL.
export interface RequireAuthOptions {
  // When true, accept the bearer as an `access_token` query parameter if the Authorization header
  // is absent. The header still wins when both are present, so this only *adds* a path for the
  // transport that cannot carry a header — it never weakens the header path. The token is validated
  // through the identical sessionService.validate, yielding the identical fresh principal (ADR-0007);
  // the query is purely an alternate carrier, not an alternate trust source. Reserved for SSE: a
  // token in a URL can reach access logs and history, a cost the header path does not pay.
  allowQueryToken?: boolean
}

// Build the pre-handler bound to a session service. Reused by every route module (auth and the
// assistant threads) so authentication is resolved one way in one place — the principal read
// fresh from the session lookup on every request, never a cached or client-supplied claim.
export function createRequireAuth(
  sessionService: SessionService,
  options: RequireAuthOptions = {},
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const headerToken = extractBearerToken(request.headers.authorization)
    // Header first; fall back to the query carrier only where the route opted in. Both go through
    // the same validate below, so the query is an alternate carrier of the exact same credential.
    const queryToken = options.allowQueryToken
      ? (request.query as { access_token?: unknown } | undefined)?.access_token
      : undefined
    const token = headerToken ?? (typeof queryToken === 'string' ? queryToken : undefined)
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
// set is one flat 403. It reads only the resolved principal, so it needs no session service.
//
// Every call site names the roles it admits in full. Until 2026-08-23 naming 'admin' silently
// admitted 'super_admin' too, which was correct only while the two were twins; now that an admin
// is bound to one branch, an implicit widening here would be a bug at every call site.
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

// The capability guard that replaced most fixed role guards (owner ask 2026-08-24): gate an
// endpoint on the caller's role holding a capability, answered by the catalog defaults plus
// the owner's stored overrides — so what a role may do is data the owner edits, not code.
// Runs after requireAuth, like the role guard. Naming several keys admits a caller holding
// ANY of them (a page read is open to whoever holds the page). super_admin short-circuits
// to true inside the shared isCapabilityAllowed, so the owner can never lock themself out.
export function createRequireCapability(
  accessService: AccessService,
): (...keys: CapabilityKey[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return (...keys) =>
    async (request, reply) => {
      const principal = request.principal as Principal
      for (const key of keys) {
        if (await accessService.isAllowed(principal.role, key)) {
          return
        }
      }
      await reply.code(403).send(FORBIDDEN)
    }
}
