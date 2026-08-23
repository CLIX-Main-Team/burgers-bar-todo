import { type PrincipalResponse, hasAdminAuthority } from '@burgers/shared'

// Who may reach the provisioning surface (`/people`): admins (branch or chain) and managers,
// never employees. One predicate, read the same way by the account menu that shows the Manage
// users entry and the route guard that redirects an employee away — so a change to the
// role set is made here alone rather than in every site that asks the question.
//
// This is presentation gating only (ADR-0007): the API authorises every /people request
// independently, so this predicate is a convenience, not the security boundary.
export function canProvision(principal: PrincipalResponse): boolean {
  return hasAdminAuthority(principal.role) || principal.role === 'manager'
}

// Who may reach the locations surface (`/locations`): admin-level, never managers or
// employees — creating and renaming branches is an admin-level act (#165). A branch admin
// reaches this surface too (2026-08-23): it simply resolves to their own branch, the same way
// the API scopes the read. Like `canProvision`, one predicate read the same way by the side
// nav and the account menu that gate the Manage locations entry, so the role set lives here
// alone rather than as a bare admin comparison literal repeated at each site. Presentation
// gating only (ADR-0007): the API authorises every /locations request independently.
export function canManageLocations(principal: PrincipalResponse): boolean {
  return hasAdminAuthority(principal.role)
}
