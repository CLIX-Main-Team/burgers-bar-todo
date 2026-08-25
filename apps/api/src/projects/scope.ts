import { type SQL, and, or, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import { projects } from '../db/schema.js'

// The project scope predicate, the projects twin of `task-board/scope.ts` (ADR-0007). It is the
// only way the project data-access layer ever selects rows — there is no unscoped path.
//
// A project is scoped on TWO axes:
//
//   place — the branches the project names, or none at all. Somebody sees the projects running at
//           their own branch, and the chain-wide ones. That second half matters: a menu rollout
//           names no branch, and somebody who could not see it could not see the work they are
//           doing inside it.
//   role  — the roles the project names. This is the owner's call (2026-08-23): roles are not a
//           label, they decide who the project is FOR. A kashrut audit that names only managers
//           does not appear for an employee, at any branch.
//
// A super_admin bypasses both — they are the chain, and a project they could not see would be a
// project nobody is accountable for.
//
// A branch admin passes on PLACE ALONE: the role axis is not theirs. Being an admin is not one
// more box on the picker, it is answering for a place, so choosing where a project runs is what
// names its admins (owner call 2026-08-25, settling a question he asked and then re-answered
// himself): chain-wide names every admin, one branch names that branch's admin and no other. There
// is no third thing for the role list to say about them, which is why the form ticks the two admin
// rows for you and will not let you untick them.
//
// Everyone below them has to pass BOTH axes: the role list is the manager's and the employee's,
// where it decides who the project is FOR rather than merely labelling it.
//
// Anything else fails closed to an empty list rather than leaking rows.
export function projectScopePredicate(principal: Principal): SQL {
  // `= any(...)` against the arrays already on the row being considered, rather than two joins.
  // The cast on the branch id is load-bearing: the parameter arrives as text and Postgres will not
  // compare it to a uuid[] member without being told what it is.
  const namesMyRole = sql`${principal.role} = any(${projects.roles})`
  const chainWide = sql`cardinality(${projects.locationIds}) = 0`
  const namesMyBranch = principal.locationId
    ? sql`${principal.locationId}::uuid = any(${projects.locationIds})`
    : sql`false`
  // Anybody carrying no branch falls back to the chain-wide projects only, never to another
  // branch's, which is the fail-closed instinct the board's predicate has too.
  const inMyPlace = or(chainWide, namesMyBranch) as SQL

  switch (principal.role) {
    case 'super_admin':
      return sql`true`
    case 'admin':
      return inMyPlace
    case 'manager':
    case 'employee':
      return and(inMyPlace, namesMyRole) as SQL
    default:
      return sql`false`
  }
}
