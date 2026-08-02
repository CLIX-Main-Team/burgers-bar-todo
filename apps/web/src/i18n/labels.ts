import type { Role, UserStatus } from '@burgers/shared'

// The one place the role and status enums map to their message keys, so the label a
// user sees is derived the same way everywhere (the user list and the in-app header both
// read these). Adding a role or a status changes this map alone rather than every site
// that renders one.
export function roleLabelKey(role: Role): string {
  switch (role) {
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
