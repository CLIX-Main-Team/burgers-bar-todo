import { type SQL, and, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import { projects } from '../db/schema.js'

// The project scope predicate, the projects twin of `task-board/scope.ts` (ADR-0007). It is the
// only way the project data-access layer ever selects rows — there is no unscoped path.
//
// A project is scoped on TWO axes, and a row has to pass both:
//
//   place — the branches the project names, or none at all. A manager or an employee sees the
//           projects running at their own branch and every chain-wide one. That second half
//           matters: a menu rollout names no branch, and somebody who could not see it could not
//           see the work they are doing inside it.
//   role  — the roles the project names. This is the owner's call (2026-08-23): roles are not a
//           label, they decide who the project is FOR. A kashrut audit that names only managers
//           does not appear for an employee, at any branch.
//
// Both admin roles bypass BOTH axes, the same way they bypass every other scope in the app — they
// are the chain, and a project they could not see would be a project nobody is accountable for.
// The roles picker still offers them, because naming them says who is involved; what it cannot do
// is take a project away from them, and the form's hint says so in as many words.
//
// Anything else fails closed to an empty list rather than leaking rows.
export function projectScopePredicate(principal: Principal): SQL {
  switch (principal.role) {
    case 'super_admin':
    case 'admin':
      return sql`true`
    case 'manager':
    case 'employee': {
      // `= any(...)` against the arrays already on the row being considered, rather than two
      // joins. The cast on the branch id is load-bearing: the parameter arrives as text and
      // Postgres will not compare it to a uuid[] member without being told what it is.
      const namesMyRole = sql`${principal.role} = any(${projects.roles})`
      const chainWide = sql`cardinality(${projects.locationIds}) = 0`
      // A manager or employee somehow carrying no branch falls back to chain-wide projects only,
      // never to another branch's — the same fail-closed instinct the board's predicate has.
      const inMyPlace = principal.locationId
        ? sql`(${chainWide} or ${principal.locationId}::uuid = any(${projects.locationIds}))`
        : chainWide
      return and(inMyPlace, namesMyRole) as SQL
    }
    default:
      return sql`false`
  }
}
