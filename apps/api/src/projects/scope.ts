import { type SQL, eq, isNull, or, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import { projects } from '../db/schema.js'

// The project scope predicate, the projects twin of `task-board/scope.ts` (ADR-0007). It is the
// only way the project data-access layer ever selects rows — there is no unscoped path.
//
//   Admin (either role) — chain-wide, no filter.
//   Manager            — their own branch's projects, PLUS every chain-wide project. That second
//                        half is the difference from the task predicate and it is deliberate: a
//                        winter menu rollout has no branch, and a manager who could not see it
//                        could not see the work their own staff are doing inside it.
//   Anyone else        — nothing. Projects is a manager-and-up surface, and the route guard says
//                        so too; this fails closed rather than trusting that guard to be the only
//                        thing standing between an employee and the chain's plans.
//
// A manager somehow carrying no location falls back to chain-wide projects only, never to
// another branch's — the same fail-closed instinct the board's predicate has.
export function projectScopePredicate(principal: Principal): SQL {
  switch (principal.role) {
    case 'super_admin':
    case 'admin':
      return sql`true`
    case 'manager': {
      const chainWide = isNull(projects.locationId)
      if (!principal.locationId) return chainWide
      return or(chainWide, eq(projects.locationId, principal.locationId)) as SQL
    }
    default:
      return sql`false`
  }
}
