import type { PrincipalResponse } from '@burgers/shared'

// Who may reach the provisioning surface (`/people`): admins and managers, never
// employees. One predicate, read the same way by the account menu that shows the Manage
// users entry and the route guard that redirects an employee away — so a change to the
// role set is made here alone rather than in every site that asks the question.
//
// This is presentation gating only (ADR-0007): the API authorises every /people request
// independently, so this predicate is a convenience, not the security boundary.
export function canProvision(principal: PrincipalResponse): boolean {
  return principal.role === 'admin' || principal.role === 'manager'
}
