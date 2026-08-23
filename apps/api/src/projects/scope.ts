import { type SQL, and, eq, isNull, or, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import { projects } from '../db/schema.js'

// The project scope predicate, the projects twin of `task-board/scope.ts` (ADR-0007). It is the
// only way the project data-access layer ever selects rows — there is no unscoped path.
//
// A project is scoped on TWO axes, and a row has to pass both:
//
//   place — the project's branch, or chain-wide. A manager or an employee sees their own branch's
//           projects and every chain-wide one. That second half matters: a menu rollout has no
//           branch, and somebody who could not see it could not see the work they are doing
//           inside it.
//   role  — the roles the project names. This is the owner's call (2026-08-23): roles are not a
//           label, they decide who the project is FOR. A kashrut audit that names only managers
//           does not appear for an employee, at any branch.
//
// Both admin roles bypass the role axis entirely, the same way they bypass every other scope in
// the app — they are the chain, and a project they could not see would be a project nobody is
// accountable for. That is why `admin` and `super_admin` are not offered as choices in the roles
// picker: implying they could be excluded would be a lie.
//
// Anything else fails closed to an empty list rather than leaking rows.
export function projectScopePredicate(principal: Principal): SQL {
  switch (principal.role) {
    case 'super_admin':
    case 'admin':
      return sql`true`
    case 'manager':
    case 'employee': {
      // `= any(roles)` against the text array rather than a join — the set has two members and is
      // already on the row being considered.
      const namesMyRole = sql`${principal.role} = any(${projects.roles})`
      const chainWide = isNull(projects.locationId)
      // A manager or employee somehow carrying no branch falls back to chain-wide projects only,
      // never to another branch's — the same fail-closed instinct the board's predicate has.
      const inMyPlace = principal.locationId
        ? or(chainWide, eq(projects.locationId, principal.locationId))
        : chainWide
      return and(inMyPlace, namesMyRole) as SQL
    }
    default:
      return sql`false`
  }
}
