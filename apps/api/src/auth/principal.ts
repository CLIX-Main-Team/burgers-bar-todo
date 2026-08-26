import {
  type PreferredLanguage,
  type Role,
  type ScopeChoice,
  type UserStatus,
  VIEW_SCOPE_DEFAULTS,
  type ViewScopeKey,
  type ViewScopes,
} from '@burgers/shared'

// The per-request principal (ADR-0007): who the caller is, resolved fresh from the
// session lookup on every request. Nothing here is trusted from the client — the
// bearer token is the only input, and role/location/status come from the users row
// behind it, so a reassignment or deactivation is honoured on the very next request.
export interface Principal {
  userId: string
  displayName: string
  role: Role
  locationId: string | null
  status: UserStatus
  // How far this role sees, resolved with the session (owner ask 2026-08-26) and read by the
  // tier-two scope predicates. Optional so a principal built by hand — every unit test, and
  // any future caller that has no access service — still describes a complete caller; absent,
  // `viewScope` below answers with the role default, which is what those predicates did
  // before the setting existed.
  viewScopes?: ViewScopes
  // The language this person reads the app in, resolved with the session (2026-08-26). Read by
  // the one path that writes text a person will later read back: the opening checklist a new
  // branch's project is created from. Optional for the same reason viewScopes is — a principal
  // built by hand in a test is still a complete caller — and absent it falls back to the column
  // default, `he`.
  preferredLanguage?: PreferredLanguage
}

// The horizon this principal reads on one view. The single accessor every scope predicate
// goes through, so "no setting resolved" means "as the role always behaved" in exactly one
// place rather than at each predicate.
export function viewScope(principal: Principal, key: ViewScopeKey): ScopeChoice {
  return principal.viewScopes?.[key] ?? VIEW_SCOPE_DEFAULTS[key][principal.role]
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
