import type { Role, UserStatus } from '@burgers/shared'

// The per-request principal (ADR-0007): who the caller is, resolved fresh from the
// session lookup on every request. Nothing here is trusted from the client — the
// bearer token is the only input, and role/location/status come from the users row
// behind it, so a reassignment or deactivation is honoured on the very next request.
export interface Principal {
  userId: string
  role: Role
  locationId: string | null
  status: UserStatus
}

// Pull the raw token out of an `Authorization: Bearer <token>` header. Anything that
// is not exactly that shape — no header, a non-Bearer scheme, an empty token — yields
// undefined, which the caller turns into a generic 401. Kept liberal on surrounding
// whitespace but strict on the scheme.
export function extractBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined
  const match = /^Bearer +(\S+)$/.exec(authorization.trim())
  return match?.[1]
}
