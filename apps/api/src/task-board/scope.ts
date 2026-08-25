import { type SQL, and, eq, or, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import { taskAssignees, tasks } from '../db/schema.js'

// The central scope predicate (ADR-0007, the security core every board slice reuses). It turns
// the per-request principal into the row filter for the `tasks` table, and it is the *only* way
// the task data-access layer ever selects tasks — there is no unscoped "get all tasks" path a
// caller could reach without a principal. Because the very same predicate will gate writes in the
// later slices, two properties fall out for free and are therefore not separate rules: an employee
// never sees the backlog (their assignee-membership filter excludes empty-assignee tasks), and a
// manager never touches another location's board.
//
// Since 2026-08-25 the table holds two kinds of row and the predicate is their union:
//
//   Shared board work — filtered by role, as it always was:
//     - super_admin — the chain: no location filter (a `true` tautology keeps the call site uniform).
//     - Admin      — their own branch only, exactly like a manager (2026-08-23).
//     - Manager  — their own location only.
//     - Employee — only tasks whose assignee set names them; the empty-set backlog is excluded
//                  for free because no assignee row names anyone.
//
//   Private work — the writer's own, and nobody else's. Role does not enter into it: this is the
//     one filter in the app that narrows a super_admin, and it has to be, or "private" would be a
//     promise the app breaks for the one account that can read everything.
//
// Anything other than these roles, and a non-admin somehow carrying no location, fail closed
// to an empty board (`false`) rather than leaking rows — the security default for the one helper
// the whole board trusts.
export function taskScopePredicate(principal: Principal): SQL {
  const sharedWork = and(sql`not ${tasks.personal}`, rolePredicate(principal))
  // Ownership is `created_by`, not the assignee set: the write service pins a private task's only
  // assignee to its creator, so the two agree, and the creator is the column no edit can change.
  const myOwn = and(sql`${tasks.personal}`, eq(tasks.createdBy, principal.userId))
  return or(sharedWork, myOwn) as SQL
}

function rolePredicate(principal: Principal): SQL {
  switch (principal.role) {
    case 'super_admin':
      return sql`true`
    case 'admin':
    case 'manager':
      // A branch admin and a manager are scoped identically: their one branch. A principal in
      // either role that somehow carries no location fails closed to an empty board rather than
      // widening to the whole chain.
      if (!principal.locationId) return sql`false`
      return eq(tasks.locationId, principal.locationId)
    case 'employee':
      // Correlated EXISTS against the assignee set of the row under consideration. Expressed as a
      // fragment (not a `db`-bound subquery) so this helper stays a pure principal→predicate
      // function the data-access layer composes; `tasks.id` resolves to the outer query's row.
      return sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${principal.userId})`
    default:
      return sql`false`
  }
}
