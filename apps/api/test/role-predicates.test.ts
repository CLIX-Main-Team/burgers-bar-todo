import { type Role, hasAdminAuthority, isSuperAdmin } from '@burgers/shared'
import { describe, expect, it } from 'vitest'

// The two questions that used to be one. `isChainAdmin` answered both "is this the chain's owner"
// and "does this person hold admin-level power here", which was harmless only while the two roles
// were twins. These cases pin the split so neither predicate can quietly widen back.
describe('role predicates', () => {
  const roles: Role[] = ['super_admin', 'admin', 'manager', 'employee']

  it('names only super_admin as chain-wide', () => {
    expect(roles.filter(isSuperAdmin)).toEqual(['super_admin'])
  })

  it('names both admin roles as holding admin-level authority', () => {
    expect(roles.filter(hasAdminAuthority)).toEqual(['super_admin', 'admin'])
  })
})
