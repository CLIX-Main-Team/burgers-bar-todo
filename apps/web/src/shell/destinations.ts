import type { PrincipalResponse } from '@burgers/shared'
import { canManageLocations, hasCapability } from '../auth/roles.js'
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

// Every row is gated by its page capability (owner ask 2026-08-24): which roles see which
// pages is data the owner edits from the Access page, arriving on the principal's
// capability list, not a role comparison baked in here. Defaults keep every pre-switch
// behavior (People stays out of the everyday chrome per the 2026-08-13 owner call, reached
// through the account menu).
export const DESTINATIONS: readonly Destination[] = [
  {
    to: '/dashboard',
    labelKey: 'common.navDashboard',
    icon: 'dashboard',
    show: (p) => hasCapability(p, 'page.dashboard'),
  },
  {
    to: '/tasks',
    labelKey: 'common.tabTasks',
    icon: 'tasks',
    show: (p) => hasCapability(p, 'page.tasks'),
  },
  {
    to: '/projects',
    labelKey: 'common.navProjects',
    icon: 'folder',
    show: (p) => hasCapability(p, 'page.projects'),
  },
  {
    to: '/assistant',
    labelKey: 'common.tabAssistant',
    icon: 'assistant',
    show: (p) => hasCapability(p, 'page.assistant'),
  },
  {
    to: '/knowledge',
    labelKey: 'common.navKnowledge',
    icon: 'knowledge-doc',
    show: (p) => hasCapability(p, 'page.knowledge'),
  },
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

// Where "/" lands: the first destination this principal may open. Tasks is the backstop, and
// deliberately not the Access page any more (2026-08-25: that page became the owner's alone, so
// landing a stripped role there would be a redirect loop). A role holding no page at all lands on
// a Tasks screen the API refuses, which reads as an empty board rather than a bounce.
export function firstDestination(principal: PrincipalResponse): string {
  return destinationsFor(principal)[0]?.to ?? '/tasks'
}

// The phone's tab bar: the same list minus the rail-only rows.
// The phone bar's cell budget. Five is the ceiling every guideline puts on a bottom bar
// (Material 3, Apple's HIG), and the owner's own read of the six-cell version was that it was
// too many. The last cell is always More, so four destinations reach the bar directly.
//
// Fewer cells is not only tidier, it is legible: at five cells a 390px phone gives each 78px,
// which is enough for the label at the normal caption size. At six it was 65px, which forced
// the label down to 10px to stop "Knowledge" clipping.
export const PHONE_TAB_SLOTS = 4

// Which destinations reach the bar, and which fall into More. The split is POSITIONAL, taking
// the first few in charter order, and deliberately not a flag on any one destination: the
// Access page lets the owner grant and revoke pages per role at run time (owner note
// 2026-08-30), so the list this reads is configuration, not a constant. A role can hold one
// page or all six, and both have to lay out.
//
// Order therefore carries meaning it did not before: DESTINATIONS order is what decides who
// gets a cell, so moving a row up that list promotes it on every phone.
export function tabsFor(principal: PrincipalResponse): Destination[] {
  return destinationsFor(principal).slice(0, PHONE_TAB_SLOTS)
}

// The rest, which More lists above the management rows. Empty for a role holding four pages or
// fewer, in which case More is settings and logout alone and the bar is simply shorter.
export function overflowFor(principal: PrincipalResponse): Destination[] {
  return destinationsFor(principal).slice(PHONE_TAB_SLOTS)
}
