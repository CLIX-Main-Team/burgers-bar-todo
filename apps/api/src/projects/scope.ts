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
// A branch admin passes on either axis, and this is where the two differ (owner call 2026-08-25,
// twice: first correcting the 2026-08-23 split, which narrowed the roster and the board to one
// branch and left this predicate chain-wide, then correcting the correction). Their branch's work
// is theirs to answer for whatever roles the picker happened to name — that is what running a
// branch means. Everything else is only theirs if the project says so: a chain-wide rollout that
// names only managers is chain business, not the branch admin's, and his brief said as much —
// "cant see other projects unless included in the project".
//
// Everyone below them has to pass BOTH axes.
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

  switch (principal.role) {
    case 'super_admin':
      return sql`true`
    case 'admin':
      // A principal in this role somehow carrying no branch keeps only the chain-wide projects
      // that name them, never another branch's — the same fail-closed instinct below.
      return or(namesMyBranch, and(chainWide, namesMyRole)) as SQL
    case 'manager':
    case 'employee': {
      // A manager or employee somehow carrying no branch falls back to chain-wide projects only,
      // never to another branch's — the same fail-closed instinct the board's predicate has.
      const inMyPlace = or(chainWide, namesMyBranch) as SQL
      return and(inMyPlace, namesMyRole) as SQL
    }
    default:
      return sql`false`
  }
}
