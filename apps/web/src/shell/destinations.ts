import type { PrincipalResponse } from '@burgers/shared'
import { canManageLocations, canProvision } from '../auth/roles.js'
import type { IconRole } from '../components/ui/icon-registry.js'

// The app's destinations in nav order, shared by the desktop side nav and the mobile tab bar
// (owner call 2026-08: the bar now carries the role-gated rows too, ending the phone detour
// through the account menu). One list so the two shells can never disagree on order or on who
// sees what: the two role-invariant destinations first (PRD story 6), then People for anyone
// who may provision (managers + admins) and Locations admin-only (a chain/HQ act, #165).
// Gating is presentation-only over the API's own authorization (ADR-0007).
export interface Destination {
  to: string
  labelKey: string
  icon: IconRole
  // Absent → always shown; present → the row renders only when the principal passes.
  show?: (principal: PrincipalResponse) => boolean
}

export const DESTINATIONS: readonly Destination[] = [
  { to: '/tasks', labelKey: 'common.tabTasks', icon: 'tasks' },
  { to: '/assistant', labelKey: 'common.tabAssistant', icon: 'assistant' },
  { to: '/people', labelKey: 'common.navPeople', icon: 'manage-users', show: canProvision },
  {
    to: '/locations',
    labelKey: 'common.navLocations',
    icon: 'manage-locations',
    show: canManageLocations,
  },
]

export function destinationsFor(principal: PrincipalResponse): Destination[] {
  return DESTINATIONS.filter((row) => !row.show || row.show(principal))
}
