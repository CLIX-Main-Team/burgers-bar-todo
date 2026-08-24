import type { Role } from '@burgers/shared'

// The Access page's data: what each role may see and do, written down as a typed constant.
//
// This file is a MAP of the API's real authorization, not a policy of its own (ADR-0007:
// the server authorises every request; the SPA only presents). Each row cites the guard it
// mirrors — when a guard changes, this file is the one place the page follows it. Nothing
// here grants anything.
//
// Access in this app is rarely a plain yes/no: most capabilities carry a SCOPE (the whole
// chain, one branch, only what names you). That is why a cell is a tier + a word instead of
// a toggle — a switch that cannot be flipped would promise editing this page does not do.
//
// super_admin and admin are identical today on purpose (packages/shared isChainAdmin;
// nothing may compare role === 'admin' directly). When the branch-scoped-admin work lands,
// the admin column changes HERE, cell by cell, and nowhere else in this feature.

export type AccessTier = 'full' | 'scoped' | 'none'

export interface AccessLevel {
  tier: AccessTier
  // The word printed beside the mark. 'full' defaults to access.levelYes; 'scoped' always
  // names its scope — a bare tick would hide the one fact this page exists to show.
  labelKey?: string
}

export interface AccessRow {
  key: string
  labelKey: string
  byRole: Record<Role, AccessLevel>
}

export interface AccessGroup {
  key: string
  labelKey: string
  rows: readonly AccessRow[]
}

// Column order matches the role ladder everywhere else (people-management ROLE_FILTERS).
export const ROLE_ORDER: readonly Role[] = ['super_admin', 'admin', 'manager', 'employee']

const yes: AccessLevel = { tier: 'full' }
const chain: AccessLevel = { tier: 'full', labelKey: 'access.levelChain' }
const none: AccessLevel = { tier: 'none' }
const scoped = (labelKey: string): AccessLevel => ({ tier: 'scoped', labelKey })

export const ACCESS_GROUPS: readonly AccessGroup[] = [
  {
    key: 'tasks',
    labelKey: 'access.groupTasks',
    rows: [
      {
        // task-board/scope.ts: both admin roles read the chain, a manager their branch
        // (backlog included), an employee only tasks whose assignee set names them.
        key: 'viewTasks',
        labelKey: 'access.capViewTasks',
        byRole: {
          super_admin: chain,
          admin: chain,
          manager: scoped('access.levelOwnBranch'),
          employee: scoped('access.levelAssignedOnly'),
        },
      },
      {
        // routes/task-board.ts: create/update/delete/reorder are manager-and-up; the
        // write service pins a manager to their own branch.
        key: 'manageTasks',
        labelKey: 'access.capManageTasks',
        byRole: {
          super_admin: yes,
          admin: yes,
          manager: scoped('access.levelOwnBranch'),
          employee: none,
        },
      },
      {
        // routes/task-board.ts /tasks/:id/status — the employee's sole write, and it only
        // reaches tasks the scope predicate already shows them.
        key: 'taskStatus',
        labelKey: 'access.capTaskStatus',
        byRole: {
          super_admin: yes,
          admin: yes,
          manager: yes,
          employee: scoped('access.levelOwnTasks'),
        },
      },
    ],
  },
  {
    key: 'projects',
    labelKey: 'access.groupProjects',
    rows: [
      {
        // projects/scope.ts: two axes — place (own branch or chain wide) AND the project
        // naming your role. Both admin roles bypass both axes.
        key: 'viewProjects',
        labelKey: 'access.capViewProjects',
        byRole: {
          super_admin: chain,
          admin: chain,
          manager: scoped('access.levelIfInvolved'),
          employee: scoped('access.levelIfInvolved'),
        },
      },
      {
        // routes/projects.ts: writes (project + checklist) are manager-and-up; a manager
        // may add only their own branch (projects/service.ts).
        key: 'manageProjects',
        labelKey: 'access.capManageProjects',
        byRole: {
          super_admin: yes,
          admin: yes,
          manager: scoped('access.levelOwnBranch'),
          employee: none,
        },
      },
    ],
  },
  {
    key: 'knowledge',
    labelKey: 'access.groupKnowledge',
    rows: [
      {
        // routes/threads.ts: every signed-in role chats; threads are owner-scoped.
        key: 'assistant',
        labelKey: 'access.capAssistant',
        byRole: { super_admin: yes, admin: yes, manager: yes, employee: yes },
      },
      {
        // assistant/document-metadata.ts ROLES_BY_SENSITIVITY, enforced in the retrieval
        // SQL itself. Printed as the intended ladder — owner-level reads everything
        // (the missing super_admin key there is a known bug, fixed on the role-model branch).
        key: 'assistantSources',
        labelKey: 'access.capAssistantSources',
        // Full breadth prints as full (green), even though it carries a word — a muted
        // "All documents" would read as LESS than a bare "Yes", inverting the ladder.
        byRole: {
          super_admin: { tier: 'full', labelKey: 'access.levelAllDocs' },
          admin: { tier: 'full', labelKey: 'access.levelAllDocs' },
          manager: scoped('access.levelInternalDocs'),
          employee: scoped('access.levelGeneralDocs'),
        },
      },
      {
        // routes/assistant.ts: the Knowledge browser and the Drive resync share one guard,
        // manager-and-up — so they share one row.
        key: 'knowledgeLibrary',
        labelKey: 'access.capKnowledge',
        byRole: { super_admin: yes, admin: yes, manager: yes, employee: none },
      },
    ],
  },
  {
    key: 'people',
    labelKey: 'access.groupPeople',
    rows: [
      {
        // routes/auth.ts GET /users + auth/repository.ts: admins read the chain, a manager
        // only their own branch's people.
        key: 'viewRoster',
        labelKey: 'access.capViewRoster',
        byRole: {
          super_admin: chain,
          admin: chain,
          manager: scoped('access.levelOwnBranch'),
          employee: none,
        },
      },
      {
        // auth/invite-service.ts: admins invite any role anywhere; a manager only an
        // employee into their own branch — anything else is refused, not redirected.
        key: 'invite',
        labelKey: 'access.capInvite',
        byRole: {
          super_admin: { tier: 'full', labelKey: 'access.levelAnyRole' },
          admin: { tier: 'full', labelKey: 'access.levelAnyRole' },
          manager: scoped('access.levelEmployeesOnly'),
          employee: none,
        },
      },
      {
        // routes/auth.ts deactivate/reactivate — the two admin roles alone.
        key: 'deactivate',
        labelKey: 'access.capDeactivate',
        byRole: { super_admin: yes, admin: yes, manager: none, employee: none },
      },
    ],
  },
  {
    key: 'chain',
    labelKey: 'access.groupChain',
    rows: [
      {
        // routes/locations.ts: drawing the map of branches is admin work.
        key: 'branches',
        labelKey: 'access.capBranches',
        byRole: { super_admin: yes, admin: yes, manager: none, employee: none },
      },
    ],
  },
]
