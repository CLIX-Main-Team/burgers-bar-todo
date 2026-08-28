import { ROLES, projectReachesUser } from '@burgers/shared'
import { describe, expect, it } from 'vitest'

// `projectReachesUser` is the scope predicate read forwards: instead of "which projects does this
// person see", "which people see this project". It decides two things — who the step picker may
// offer, and whose assignments are pruned when a project's reach narrows — so a widening here is
// a widening of both at once.
//
// These are pure cases over the function itself. The SQL twin inside listCandidates is checked
// through HTTP in projects.test.ts; what is pinned here is the RULE, in the one place it is
// written down.

const HERZLIYA = '11111111-1111-4111-8111-111111111111'
const RAMAT_GAN = '22222222-2222-4222-8222-222222222222'

const chainWide = { roles: ['manager'] as const, locationIds: [] as const }
const atHerzliya = { roles: ['manager'] as const, locationIds: [HERZLIYA] as const }

describe('projectReachesUser', () => {
  it('reaches a named role at any branch when the project is chain-wide', () => {
    expect(projectReachesUser(chainWide, { role: 'manager', locationId: HERZLIYA })).toBe(true)
    expect(projectReachesUser(chainWide, { role: 'manager', locationId: RAMAT_GAN })).toBe(true)
  })

  it('reaches a named role only at the branches a project names', () => {
    expect(projectReachesUser(atHerzliya, { role: 'manager', locationId: HERZLIYA })).toBe(true)
    expect(projectReachesUser(atHerzliya, { role: 'manager', locationId: RAMAT_GAN })).toBe(false)
  })

  it('does not reach a role the project never names', () => {
    expect(projectReachesUser(chainWide, { role: 'employee', locationId: HERZLIYA })).toBe(false)
  })

  // The branch picker is what names the admins (owner call 2026-08-25), so they are in without
  // the roles list saying so — chain-wide names every admin, one branch names that branch's.
  it('reaches both always-involved roles without the project naming them', () => {
    expect(projectReachesUser(chainWide, { role: 'admin', locationId: RAMAT_GAN })).toBe(true)
    expect(projectReachesUser(chainWide, { role: 'super_admin', locationId: null })).toBe(true)
    expect(projectReachesUser(atHerzliya, { role: 'admin', locationId: HERZLIYA })).toBe(true)
  })

  // The admin's implicit membership is still bounded by PLACE. Being an admin is answering for a
  // branch, not for every branch, so another branch's rollout is not theirs.
  it('does not reach an admin at a branch the project does not name', () => {
    expect(projectReachesUser(atHerzliya, { role: 'admin', locationId: RAMAT_GAN })).toBe(false)
  })

  // The fail-closed half of the scope predicate: somebody carrying no branch never falls back to
  // somebody else's. An HQ role is reached by the chain-wide project and by nothing else.
  it('reaches a branch-less person only through a chain-wide project', () => {
    const hq = { roles: ['finance_manager'] as const, locationIds: [] as const }
    const hqAtOneBranch = { roles: ['finance_manager'] as const, locationIds: [HERZLIYA] as const }
    expect(projectReachesUser(hq, { role: 'finance_manager', locationId: null })).toBe(true)
    expect(projectReachesUser(hqAtOneBranch, { role: 'finance_manager', locationId: null })).toBe(
      false,
    )
  })

  // Run over ROLES itself, so the next role added to the chain cannot slip past this rule unasked:
  // a chain-wide project naming nobody still reaches exactly the two the branch picker names.
  it('reaches only the always-involved roles when a project names none', () => {
    const namesNobody = { roles: [] as const, locationIds: [] as const }
    const reached = ROLES.filter((role) =>
      projectReachesUser(namesNobody, { role, locationId: HERZLIYA }),
    )
    expect(reached).toEqual(['super_admin', 'admin'])
  })
})
