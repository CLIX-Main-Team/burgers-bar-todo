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
  // Desktop side nav only, left out of the phone's tab bar. The bar is a five-slot surface
  // with a floor on each slot's width, so a destination that is not everyday phone work
  // stays on the rail rather than squeezing the four that are (v2 artboards: the phone bar
  // carries Tasks, Assistant, Knowledge and Locations; Projects is desktop work).
  railOnly?: boolean
}

export const DESTINATIONS: readonly Destination[] = [
  // The Dashboard (v2, round 10): the screen the app opens on, and the only one everybody
  // sees the same way — the board read behind it is already scoped per role by the API
  // (ADR-0007), so no gate here.
  { to: '/dashboard', labelKey: 'common.navDashboard', icon: 'dashboard' },
  { to: '/tasks', labelKey: 'common.tabTasks', icon: 'tasks' },
  // Projects: the containers the chain plans in. EVERY role sees this row since the owner's
  // 2026-08-23 call that a project's roles decide who it is for — an employee opens it and finds
  // the projects naming their role, scoped by the API (ADR-0007), and an empty list if none do.
  // That is also why it is no longer `railOnly`: the people it was just opened to work from a
  // phone, and a destination they cannot reach is a feature they do not have.
  { to: '/projects', labelKey: 'common.navProjects', icon: 'folder' },
  { to: '/assistant', labelKey: 'common.tabAssistant', icon: 'assistant' },
  // People left the everyday chrome (owner call 2026-08-13, during client testing): the
  // surface stays live at /people, reached through the account menu's People row instead
  // of a nav destination.
  // The Knowledge Base browser (ADR-0024): the corpus's management surface, so it carries
  // the same manager+admin gate as the API's /assistant/knowledge read.
  { to: '/knowledge', labelKey: 'common.navKnowledge', icon: 'knowledge-doc', show: canProvision },
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

// The phone's tab bar: the same list minus the rail-only rows.
export function tabsFor(principal: PrincipalResponse): Destination[] {
  return destinationsFor(principal).filter((row) => !row.railOnly)
}
