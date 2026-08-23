import type { KnowledgeCategory, Role, TaskPriority, TaskStatus, UserStatus } from '@burgers/shared'

// The one place the role and status enums map to their message keys, so the label a
// user sees is derived the same way everywhere (the user list and the in-app header both
// read these). Adding a role or a status changes this map alone rather than every site
// that renders one.
export function roleLabelKey(role: Role): string {
  switch (role) {
    case 'super_admin':
      return 'invites.roleSuperAdmin'
    case 'admin':
      return 'invites.roleAdmin'
    case 'manager':
      return 'invites.roleManager'
    case 'employee':
      return 'invites.roleEmployee'
  }
}

export function statusLabelKey(status: UserStatus): string {
  switch (status) {
    case 'invited':
      return 'users.statusInvited'
    case 'active':
      return 'users.statusActive'
    case 'deactivated':
      return 'users.statusDeactivated'
  }
}

// The task status and priority enums map to their message keys the same one-place way, so the
// board renders a task's state and urgency identically wherever they appear.
export function taskStatusLabelKey(status: TaskStatus): string {
  switch (status) {
    case 'not_started':
      return 'tasks.statusNotStarted'
    case 'in_progress':
      return 'tasks.statusInProgress'
    case 'done':
      return 'tasks.statusDone'
  }
}

export function taskPriorityLabelKey(priority: TaskPriority): string {
  switch (priority) {
    case 'medium':
      return 'tasks.priorityMedium'
    case 'normal':
      return 'tasks.priorityNormal'
    case 'high':
      return 'tasks.priorityHigh'
  }
}

// The Knowledge tab's category shelves (ADR-0024) map to their message keys the same
// one-place way — the shelf list and the file view both read this.
export function knowledgeCategoryLabelKey(category: KnowledgeCategory): string {
  switch (category) {
    case 'procedures':
      return 'knowledge.categoryProcedures'
    case 'finance':
      return 'knowledge.categoryFinance'
    case 'hr':
      return 'knowledge.categoryHr'
    case 'reports':
      return 'knowledge.categoryReports'
    case 'agreements':
      return 'knowledge.categoryAgreements'
    case 'menu':
      return 'knowledge.categoryMenu'
    case 'general':
      return 'knowledge.categoryGeneral'
  }
}
