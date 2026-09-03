import type { Role, RoleTier, TaskPriority, TaskStatus, UserStatus } from '@burgers/shared'

// The one place the role and status enums map to their message keys, so the label a
// user sees is derived the same way everywhere (the user list and the in-app header both
// read these). Adding a role or a status changes this map alone rather than every site
// that renders one.
// The Access picker's four role groups (2026-08-27). A switch rather than a template string,
// for the same reason roleLabelKey below is one: a missing key becomes a compile error here
// instead of a raw `access.tierX` rendering on the page.
export function tierLabelKey(tier: RoleTier): string {
  switch (tier) {
    case 'executive':
      return 'access.tierExecutive'
    case 'hq':
      return 'access.tierHq'
    case 'office':
      return 'access.tierOffice'
    case 'branch':
      return 'access.tierBranch'
  }
}

export function roleLabelKey(role: Role): string {
  switch (role) {
    case 'super_admin':
      return 'invites.roleSuperAdmin'
    case 'ceo':
      return 'invites.roleCeo'
    case 'chain_manager':
      return 'invites.roleChainManager'
    case 'finance_manager':
      return 'invites.roleFinanceManager'
    case 'operations_manager':
      return 'invites.roleOperationsManager'
    case 'procurement_manager':
      return 'invites.roleProcurementManager'
    case 'marketing_manager':
      return 'invites.roleMarketingManager'
    case 'brand_manager':
      return 'invites.roleBrandManager'
    case 'setup_manager':
      return 'invites.roleSetupManager'
    case 'chain_chef':
      return 'invites.roleChainChef'
    case 'office_manager':
      return 'invites.roleOfficeManager'
    case 'hq_secretary':
      return 'invites.roleHqSecretary'
    case 'bookkeeper':
      return 'invites.roleBookkeeper'
    case 'admin':
      return 'invites.roleAdmin'
    case 'manager':
      return 'invites.roleManager'
    case 'employee':
      return 'invites.roleEmployee'
    case 'driver':
      return 'invites.roleDriver'
    case 'field_ops':
      return 'invites.roleFieldOps'
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
