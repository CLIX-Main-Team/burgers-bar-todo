import { type PrincipalResponse, isChainAdmin } from '@burgers/shared'

// Who may reach the provisioning surface (`/people`): admins and managers, never
// employees. One predicate, read the same way by the account menu that shows the Manage
// users entry and the route guard that redirects an employee away — so a change to the
// role set is made here alone rather than in every site that asks the question.
//
// This is presentation gating only (ADR-0007): the API authorises every /people request
// independently, so this predicate is a convenience, not the security boundary.
export function canProvision(principal: PrincipalResponse): boolean {
  return isChainAdmin(principal.role) || principal.role === 'manager'
}

// Who may reach the locations surface (`/locations`): admins only, never managers or
// employees — creating and renaming branches is a chain/HQ act (#165). Like `canProvision`,
// one predicate read the same way by the side nav and the account menu that gate the Manage
// locations entry, so the role set lives here alone rather than as a bare admin comparison
// literal repeated at each site. Presentation gating only (ADR-0007): the API authorises
// every /locations request independently.
export function canManageLocations(principal: PrincipalResponse): boolean {
  return isChainAdmin(principal.role)
}
