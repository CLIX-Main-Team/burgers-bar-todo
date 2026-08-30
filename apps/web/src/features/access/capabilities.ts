import type { CapabilityKey, ViewScopeKey } from '@burgers/shared'
import type { IconRole } from '../../components/ui/icon-registry.js'

// What the Access page draws, and in what order (owner ask 2026-08-26). The page is a floor
// plan: eight doors, and behind each one the things a person can do once inside. So this file
// is organised by PAGE and nothing else — a page carries its icon (the same one it wears in the
// rail, because the owner is deciding what appears in somebody's rail), its switch, and the
// controls that live behind it.
//
// WHAT each role may do and HOW FAR it sees are both live data now, from GET /access. This file
// carries only the reading order and the words.

export interface AccessControlDef {
  kind: 'switch'
  key: CapabilityKey
  labelKey: string
}

export interface AccessScopeDef {
  kind: 'scope'
  key: ViewScopeKey
  labelKey: string
}

export type AccessControl = AccessControlDef | AccessScopeDef

export interface AccessPageDef {
  // The page switch itself. Every control below it cascades off when this is off.
  key: CapabilityKey
  labelKey: string
  icon: IconRole
  // The sentence under the page name in the Control section: what the page IS, in the owner's
  // terms, so he is not deciding about a word he has to translate first.
  blurbKey: string
  controls: readonly AccessControl[]
  // Set on the one page nobody can be granted. Its switch renders locked and the server
  // refuses the edit too (LOCKED_CAPABILITIES).
  lockedKey?: string
}

// The roles the page edits come from the shared schema — everyone below the owner. The owner
// is deliberately absent (owner ask 2026-08-26: "we dont have to include the super admin in
// the access page, maybe just a ? at the filter") — their answer is yes to everything and
// always has been, so a column of frozen ticks would be eight rows of noise. The tooltip
// beside the tabs says it in one line instead.
export { EDITABLE_ROLES } from '@burgers/shared'

// The pages, in rail order. Access is last because it is the room the levers are in.
export const ACCESS_PAGES: readonly AccessPageDef[] = [
  {
    key: 'page.dashboard',
    labelKey: 'common.navDashboard',
    icon: 'dashboard',
    blurbKey: 'access.blurbDashboard',
    controls: [{ kind: 'scope', key: 'dashboard.view', labelKey: 'access.scopeDashboard' }],
  },
  {
    key: 'page.tasks',
    labelKey: 'common.tabTasks',
    icon: 'tasks',
    blurbKey: 'access.blurbTasks',
    controls: [
      { kind: 'switch', key: 'tasks.manage', labelKey: 'access.capTasksManage' },
      { kind: 'switch', key: 'tasks.updateStatus', labelKey: 'access.capTasksStatus' },
      { kind: 'switch', key: 'tasks.createPersonal', labelKey: 'access.capTasksPersonal' },
    ],
  },
  {
    key: 'page.projects',
    labelKey: 'common.navProjects',
    icon: 'folder',
    blurbKey: 'access.blurbProjects',
    controls: [
      { kind: 'scope', key: 'projects.view', labelKey: 'access.scopeProjects' },
      { kind: 'switch', key: 'projects.manage', labelKey: 'access.capProjectsManage' },
      { kind: 'switch', key: 'projects.checklist', labelKey: 'access.capProjectsChecklist' },
      { kind: 'switch', key: 'projects.assign', labelKey: 'access.capProjectsAssign' },
    ],
  },
  {
    // Nothing under it on purpose: using the assistant IS opening the page, and how much of
    // the corpus it will answer from is the Knowledge horizon below, not a second setting here.
    key: 'page.assistant',
    labelKey: 'common.tabAssistant',
    icon: 'assistant',
    blurbKey: 'access.blurbAssistant',
    controls: [],
  },
  {
    key: 'page.knowledge',
    labelKey: 'common.navKnowledge',
    icon: 'knowledge-doc',
    blurbKey: 'access.blurbKnowledge',
    controls: [
      { kind: 'scope', key: 'knowledge.view', labelKey: 'access.scopeKnowledge' },
      { kind: 'switch', key: 'knowledge.sync', labelKey: 'access.capKnowledgeSync' },
    ],
  },
  {
    key: 'page.locations',
    labelKey: 'common.navLocations',
    icon: 'manage-locations',
    blurbKey: 'access.blurbLocations',
    controls: [
      { kind: 'scope', key: 'locations.view', labelKey: 'access.scopeLocations' },
      { kind: 'switch', key: 'locations.manage', labelKey: 'access.capLocationsManage' },
    ],
  },
  {
    key: 'page.users',
    labelKey: 'common.navUsers',
    icon: 'manage-users',
    blurbKey: 'access.blurbUsers',
    controls: [
      { kind: 'scope', key: 'users.view', labelKey: 'access.scopeUsers' },
      { kind: 'switch', key: 'people.invite', labelKey: 'access.capPeopleInvite' },
      { kind: 'switch', key: 'people.deactivate', labelKey: 'access.capPeopleDeactivate' },
    ],
  },
  {
    key: 'page.access',
    labelKey: 'access.heading',
    icon: 'role',
    blurbKey: 'access.blurbAccess',
    controls: [],
    lockedKey: 'access.ownerOnly',
  },
]

// Every horizon's options carry a word per view rather than one generic set: "the whole chain"
// means every branch on the roster and every document in the corpus, and saying it in the
// reader's own terms is the difference between a setting he trusts and one he guesses at.
export const SCOPE_LABEL_KEY: Record<ViewScopeKey, Record<string, string>> = {
  'dashboard.view': {
    chain: 'access.scopeTasksChain',
    branch: 'access.scopeTasksBranch',
    assigned: 'access.scopeTasksAssigned',
  },
  'projects.view': {
    chain: 'access.scopeProjectsChain',
    branch: 'access.scopeProjectsBranch',
    involved: 'access.scopeProjectsInvolved',
  },
  'knowledge.view': {
    chain: 'access.scopeKnowledgeAll',
    byRole: 'access.scopeKnowledgeByRole',
  },
  'locations.view': {
    chain: 'access.scopeLocationsAll',
    branch: 'access.scopeLocationsOwn',
  },
  'users.view': {
    chain: 'access.scopeUsersChain',
    branch: 'access.scopeUsersBranch',
  },
}
