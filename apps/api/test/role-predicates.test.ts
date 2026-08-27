import { ROLES, hasAdminAuthority, holdsBranch, isSuperAdmin } from '@burgers/shared'
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

  it('names exactly the branch trio as holding a branch', () => {
    expect(ROLES.filter(holdsBranch)).toEqual(['admin', 'manager', 'employee'])
  })
})
