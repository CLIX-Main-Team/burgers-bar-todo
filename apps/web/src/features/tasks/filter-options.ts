import { ROLES, type Role, type UserSummary } from '@burgers/shared'
import { ANY_FILTER, BACKLOG_FILTER } from './task-filters.js'

// What the board's three filters are allowed to OFFER (owner ask 2026-08-21: "if I choose a
// specific role, only those users should be filterable; if I select a specific branch, only
// users inside that branch should be seeable").
//
// The rule behind all of it: a filter must never offer a choice that can only ever empty the
// board. Branch and role are properties of a PERSON, so they narrow downward — branch narrows
// role and person, role narrows person — and the person filter, the narrowest of the three,
// is the one that ends up showing three faces instead of twelve. The branch list itself is
// never narrowed: it is a list of places the chain owns, not a set derived from who works
// where, and a branch that vanished from its own filter would read as a branch that closed.
//
// This is deliberately MEMBERSHIP, not evidence: it asks who works there, never who happens to
// have a task on the board right now. A roster that reshuffled itself as tasks were created and
// completed would be a filter you could not learn.

// A chain-wide account carries no location (`locationId: null`) because it works at ALL of
// them, so it survives every branch narrowing rather than belonging to none — the opposite
// reading would hide the very person who assigned half the board.
export function worksAtBranch(user: UserSummary, branchId: string): boolean {
  return branchId === ANY_FILTER || user.locationId === null || user.locationId === branchId
}

export function holdsRole(user: UserSummary, role: Role | typeof ANY_FILTER): boolean {
  return role === ANY_FILTER || user.role === role
}

// The people the person filter may offer under the branch and role above it.
export function peopleForFacets(
  users: UserSummary[],
  branchId: string,
  role: Role | typeof ANY_FILTER,
): UserSummary[] {
  return users.filter((user) => worksAtBranch(user, branchId) && holdsRole(user, role))
}

// The roles the role filter may offer under the branch above it — only the ones somebody at
// that branch actually holds, in ROLES' own seniority order so the filter always reads the
// same way whichever roles a branch has.
export function rolesForBranch(users: UserSummary[], branchId: string): Role[] {
  return ROLES.filter((role) =>
    users.some((user) => user.role === role && worksAtBranch(user, branchId)),
  )
}

// Whether a chosen person survives a narrowing that just happened above them. The backlog pile
// is not a person and never survives a ROLE choice: a task with nobody on it has nobody to hold
// one, so the pair is a contradiction that always empties the board. It survives a branch choice
// fine, since unassigned tasks belong to a branch like any other.
export function personSurvives(
  users: UserSummary[],
  assigneeId: string,
  branchId: string,
  role: Role | typeof ANY_FILTER,
): boolean {
  if (assigneeId === ANY_FILTER) return true
  if (assigneeId === BACKLOG_FILTER) return role === ANY_FILTER
  return users.some(
    (user) => user.id === assigneeId && worksAtBranch(user, branchId) && holdsRole(user, role),
  )
}
