import {
  type CapabilityKey,
  type PrincipalResponse,
  type ScopeChoice,
  VIEW_SCOPE_DEFAULTS,
  type ViewScopeKey,
} from '@burgers/shared'

// Presentation gating over the principal's capability list (owner ask 2026-08-24: what a
// role may do is data the owner edits from the Access page, not code). The list arrives on
// /auth/me, computed server-side from the catalog defaults plus the stored overrides, so
// every question here follows a flipped switch on the next principal fetch.
//
// This is presentation gating only (ADR-0007): the API authorises every request
// independently through the same service, so these are a convenience, not the boundary.
export function hasCapability(principal: PrincipalResponse, key: CapabilityKey): boolean {
  return principal.capabilities.includes(key)
}

// Who may reach the provisioning surface (`/people`): whoever holds the Users page. One
// predicate, read the same way by the account menu that shows the Users entry and the route
// guard that redirects everyone else away.
export function canProvision(principal: PrincipalResponse): boolean {
  return hasCapability(principal, 'page.users')
}

// Who may reach the locations surface (`/locations`): whoever holds the Locations page.
export function canManageLocations(principal: PrincipalResponse): boolean {
  return hasCapability(principal, 'page.locations')
}

// The horizon a role sees through, as the API resolved it on /auth/me (2026-09-20). The
// screens that draw differently per horizon read it here: the Tasks board opens on department
// chips for a `chain` horizon and straight on the viewer's own department otherwise. A principal
// answered before the field existed (a stale cached session in a test) falls back to the role's
// catalog default, which is what the API would have said.
export function viewScopeOf(principal: PrincipalResponse, key: ViewScopeKey): ScopeChoice {
  return principal.viewScopes?.[key] ?? VIEW_SCOPE_DEFAULTS[key][principal.role]
}
