import {
  ROLES,
  assignableRoles,
  hasAdminAuthority,
  holdsLocation,
  isSuperAdmin,
  roleAllowedAt,
} from '@burgers/shared'
import { describe, expect, it } from 'vitest'

// The two questions that used to be one. `isChainAdmin` answered both "is this the chain's owner"
// and "does this person hold admin-level power here", which was harmless only while the two roles
// were twins. These cases pin the split so neither predicate can quietly widen back. Run over
// ROLES itself so the HQ expansion (2026-08-27) cannot slip a role past any predicate unasked.
describe('role predicates', () => {
  it('names only super_admin as chain-wide', () => {
    expect(ROLES.filter(isSuperAdmin)).toEqual(['super_admin'])
  })

  it('names both admin roles as holding admin-level authority', () => {
    expect(ROLES.filter(hasAdminAuthority)).toEqual(['super_admin', 'admin'])
  })

  // Every role but the owner sits somewhere (2026-09-20): the HQ roles at the head office,
  // the rest at a branch. The predicate names the one exception, not a list.
  it('names every role but super_admin as holding a location', () => {
    expect(ROLES.filter((role) => !holdsLocation(role))).toEqual(['super_admin'])
  })

  // A branch takes every role with its admin on top; the head office takes every role but
  // admin, since the super admin runs it. Pinned over ROLES so a new role answers for both.
  it('seats every role at a branch except the owner, and every role but admin at HQ', () => {
    expect(ROLES.filter((role) => !roleAllowedAt(role, 'branch'))).toEqual(['super_admin'])
    expect(ROLES.filter((role) => !roleAllowedAt(role, 'headquarters'))).toEqual([
      'super_admin',
      'admin',
    ])
  })

  // The ladder (owner call 2026-08-25, restated 2026-09-20): the admin roles task anyone, a
  // manager keeps the shift without tasking the admin, an employee tasks the desk roles under
  // them and nobody above, the HQ managers task every branch rung, and the office staff task
  // below the branch admin, never the admin. The manager row is the one the owner named
  // outright.
  it('lets each rung hand work to its own rung and below', () => {
    expect(assignableRoles('super_admin')).toEqual(ROLES)
    expect(assignableRoles('admin')).toEqual(ROLES)
    expect(assignableRoles('manager')).toEqual(['manager', 'employee', 'driver', 'field_ops'])
    expect(assignableRoles('employee')).toEqual(['employee', 'driver', 'field_ops'])
    expect(assignableRoles('driver')).toEqual(['driver', 'field_ops'])
    expect(assignableRoles('finance_manager')).not.toContain('ceo')
    expect(assignableRoles('finance_manager')).toContain('operations_manager')
    expect(assignableRoles('finance_manager')).toContain('admin')
    expect(assignableRoles('bookkeeper')).not.toContain('admin')
    expect(assignableRoles('bookkeeper')).toContain('manager')
    expect(assignableRoles('ceo')).toEqual(ROLES.filter((role) => role !== 'super_admin'))
  })
})
