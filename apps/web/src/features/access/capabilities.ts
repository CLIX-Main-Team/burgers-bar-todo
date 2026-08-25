import type { CapabilityKey, Role } from '@burgers/shared'

// The Access page's presentation map (owner ask 2026-08-24). WHAT each role may do is live
// data now — the matrix from GET /access, edited by the owner's switches — so this file
// carries only how the page reads: the grouping and order, each capability's label key, and
// the SCOPE word a role's ON state carries. Scope stays derived from the role itself (chain
// wide / own branch / only what names you, the tier-two predicates in the API) and is not
// editable; a switch gates yes/no, the role's nature decides how far.

export interface AccessRowDef {
  key: CapabilityKey
  labelKey: string
  // The word printed beside an ON state, per role. Absent = plain "Yes". These describe the
  // API's scope predicates, not policy of their own.
  scopeByRole?: Partial<Record<Role, string>>
}

export interface AccessGroupDef {
  key: string
  labelKey: string
  rows: readonly AccessRowDef[]
}

// Column order matches the role ladder everywhere else (people-management ROLE_FILTERS).
export const ROLE_ORDER: readonly Role[] = ['super_admin', 'admin', 'manager', 'employee']

// Since the branch-admin split (2026-08-23) an admin holds one branch and is scoped by it
// almost everywhere a manager is; only the super_admin spans the chain.
const chainOrBranch = {
  super_admin: 'access.levelChain',
  admin: 'access.levelOwnBranch',
  manager: 'access.levelOwnBranch',
  employee: 'access.levelOwnBranch',
} as const

// Private work is nobody else's, whatever the role (2026-08-25).
const selfOnly = {
  super_admin: 'access.levelSelfOnly',
  admin: 'access.levelSelfOnly',
  manager: 'access.levelSelfOnly',
  employee: 'access.levelSelfOnly',
} as const

export const ACCESS_GROUPS: readonly AccessGroupDef[] = [
  {
    key: 'general',
    labelKey: 'access.groupGeneral',
    rows: [
      {
        key: 'page.dashboard',
        labelKey: 'access.capPageDashboard',
        scopeByRole: { super_admin: 'access.levelChain', admin: 'access.levelOwnBranch' },
      },
      { key: 'page.access', labelKey: 'access.capPageAccess' },
    ],
  },
  {
    key: 'tasks',
    labelKey: 'access.groupTasks',
    rows: [
      {
        // task-board/scope.ts: admins read the chain, branch staff their branch, an
        // employee only tasks whose assignee set names them.
        key: 'page.tasks',
        labelKey: 'access.capPageTasks',
        scopeByRole: { ...chainOrBranch, employee: 'access.levelAssignedOnly' },
      },
      {
        // task-write-service.ts: an admin role runs its whole board; a manager tasks their own
        // level and down, and edits or deletes the work they wrote themselves.
        key: 'tasks.manage',
        labelKey: 'access.capTasksManage',
        scopeByRole: { ...chainOrBranch, manager: 'access.levelOwnAssignments' },
      },
      {
        key: 'tasks.createPersonal',
        labelKey: 'access.capTasksPersonal',
        scopeByRole: selfOnly,
      },
      {
        key: 'tasks.updateStatus',
        labelKey: 'access.capTasksStatus',
        scopeByRole: { employee: 'access.levelOwnTasks' },
      },
    ],
  },
  {
    key: 'projects',
    labelKey: 'access.groupProjects',
    rows: [
      {
        // projects/scope.ts: two axes — place AND the project naming your role; BOTH admin
        // roles bypass both (a project a branch admin could not see would be work nobody
        // at their branch is accountable for).
        key: 'page.projects',
        labelKey: 'access.capPageProjects',
        scopeByRole: {
          super_admin: 'access.levelChain',
          // Their branch's projects whatever roles those name, plus the chain-wide ones that
          // name admins — the two halves of the predicate, in one phrase.
          admin: 'access.levelOwnBranchOrInvolved',
          manager: 'access.levelIfInvolved',
          employee: 'access.levelIfInvolved',
        },
      },
      {
        // projects/service.ts resolveProjectLocations: a project spanning branches, or naming
        // none, is the owner's; everyone else authors at their own branch and exactly there.
        key: 'projects.manage',
        labelKey: 'access.capProjectsManage',
        scopeByRole: { super_admin: 'access.levelChain', admin: 'access.levelOwnBranch' },
      },
      {
        // The other half of the same split: ticking a line is doing the work, so it reaches
        // whoever the project reaches.
        key: 'projects.checklist',
        labelKey: 'access.capProjectsChecklist',
        scopeByRole: {
          super_admin: 'access.levelChain',
          admin: 'access.levelOwnBranchOrInvolved',
          manager: 'access.levelIfInvolved',
          employee: 'access.levelIfInvolved',
        },
      },
    ],
  },
  {
    key: 'knowledge',
    labelKey: 'access.groupKnowledge',
    rows: [
      { key: 'page.assistant', labelKey: 'access.capPageAssistant' },
      { key: 'page.knowledge', labelKey: 'access.capPageKnowledge' },
      { key: 'knowledge.sync', labelKey: 'access.capKnowledgeSync' },
    ],
  },
  {
    key: 'people',
    labelKey: 'access.groupPeople',
    rows: [
      {
        key: 'page.users',
        labelKey: 'access.capPageUsers',
        scopeByRole: chainOrBranch,
      },
      {
        // auth/invite-service.ts: the owner bakes any role anywhere; a branch admin hires
        // managers and employees into their own branch; anyone else branch-held bakes
        // employee invites into their own branch only.
        key: 'people.invite',
        labelKey: 'access.capPeopleInvite',
        scopeByRole: {
          super_admin: 'access.levelAnyRole',
          admin: 'access.levelStaffRoles',
          manager: 'access.levelEmployeesOnly',
          employee: 'access.levelEmployeesOnly',
        },
      },
      {
        // routes/auth.ts: resending and revoking are the paperwork after the hire, and stay
        // with the branch admin — a manager invites and stops there.
        key: 'people.manageInvites',
        labelKey: 'access.capPeopleManageInvites',
        scopeByRole: { super_admin: 'access.levelChain', admin: 'access.levelOwnBranch' },
      },
      {
        // auth/repository.ts accountActionScopePredicate: a branch admin reaches only
        // their own branch's non-admin rows; the owner reaches anyone.
        key: 'people.deactivate',
        labelKey: 'access.capPeopleDeactivate',
        scopeByRole: {
          super_admin: 'access.levelChain',
          admin: 'access.levelOwnBranch',
        },
      },
    ],
  },
  {
    key: 'chain',
    labelKey: 'access.groupChain',
    rows: [
      {
        key: 'page.locations',
        labelKey: 'access.capPageLocations',
        scopeByRole: {
          super_admin: 'access.levelChain',
          admin: 'access.levelOwnBranch',
          manager: 'access.levelOwnBranchReadOnly',
        },
      },
      {
        // routes/locations.ts: editing a branch rides this switch under the repository's
        // LocationScope; creating or deleting one stays the owner's chain act regardless.
        key: 'locations.manage',
        labelKey: 'access.capLocationsManage',
        scopeByRole: { super_admin: 'access.levelChain', admin: 'access.levelOwnBranch' },
      },
    ],
  },
]
