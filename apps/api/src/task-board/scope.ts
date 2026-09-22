import { type SQL, and, eq, isNull, or, sql } from 'drizzle-orm'
import { type Principal, viewScope } from '../auth/principal.js'
import { taskAssignees, taskSubjects, tasks } from '../db/schema.js'

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
//   Shared board work — filtered by the role's HORIZON, which since 2026-08-26 is a setting the
//   owner moves on the Access page rather than a fact of the role (dashboard.view, so named
//   because the dashboard's totals are this same read summed). Its defaults are the three
//   behaviours that were hard-coded here before:
//     - chain    — no location filter (a `true` tautology keeps the call site uniform); the
//                  super_admin's horizon, and one the owner may now hand to anyone.
//     - branch   — their own location only; what an admin and a manager held (2026-08-23).
//     - assigned — only tasks whose assignee set names them; the employee's, and the empty-set
//                  backlog is excluded for free because no assignee row names anyone.
//
//   Private work — the writer's own, and nobody else's. Role does not enter into it: this is the
//     one filter in the app that narrows a super_admin, and it has to be, or "private" would be a
//     promise the app breaks for the one account that can read everything.
//
// A principal whose horizon is a branch but who carries no location fails closed to an empty
// board (`false`) rather than widening to the chain — the security default for the one helper
// the whole board trusts.
//
// Since 2026-09-20 shared work is also filed under a subject, and a subject under a department,
// so a second horizon narrows it: tasks.departments, `chain` (every department) or `department`
// (only the one on the viewer's own users row). The two compose with AND, so a branch manager in
// finance sees their branch's finance tasks. It lives here, in the one predicate, so the dashboard
// totals and the assistant's my_tasks tool narrow exactly as the board does.
export function taskScopePredicate(principal: Principal): SQL {
  const sharedWork = and(
    sql`not ${tasks.personal}`,
    rolePredicate(principal),
    sql`exists (select 1 from ${taskSubjects} where ${taskSubjects.id} = ${tasks.subjectId} and ${subjectPredicate(principal)})`,
  )
  // Ownership is `created_by`, not the assignee set: the write service pins a private task's only
  // assignee to its creator, so the two agree, and the creator is the column no edit can change.
  const myOwn = and(sql`${tasks.personal}`, eq(tasks.createdBy, principal.userId))
  return or(sharedWork, myOwn) as SQL
}

// Which subjects this viewer reaches (task_subjects rows): the department horizon AND the branch
// rule. Exported because the subjects read (task-subjects/repository.ts) is the same question
// asked of subjects directly, and two spellings of one rule is how they drift.
export function subjectPredicate(principal: Principal): SQL {
  return and(departmentPredicate(principal), subjectBranchPredicate(principal)) as SQL
}

// The branch rule over subjects (owner ask 2026-09-20, evening): a subject is the chain's (null
// branch) or one branch's. A chain-horizon viewer reaches both kinds everywhere; everyone else
// reaches the chain's plus their own branch's, and never another branch's. A viewer with no
// branch and no chain horizon (an HQ role held to "assigned") reaches the chain's alone.
export function subjectBranchPredicate(principal: Principal): SQL {
  if (viewScope(principal, 'dashboard.view') === 'chain') return sql`true`
  return or(
    isNull(taskSubjects.locationId),
    principal.locationId ? eq(taskSubjects.locationId, principal.locationId) : sql`false`,
  ) as SQL
}

// The department horizon over the task_subjects table (2026-09-20): every department on a chain
// horizon, the viewer's own otherwise. A viewer held to their department who has none fails closed
// to nothing, for the same reason the branch rule does above: "not placed yet" must not read as
// "may see everything".
export function departmentPredicate(principal: Principal): SQL {
  switch (viewScope(principal, 'tasks.departments')) {
    case 'chain':
      return sql`true`
    case 'department':
      if (!principal.departmentId) return sql`false`
      return eq(taskSubjects.departmentId, principal.departmentId)
    default:
      return sql`false`
  }
}

function rolePredicate(principal: Principal): SQL {
  switch (viewScope(principal, 'dashboard.view')) {
    case 'chain':
      return sql`true`
    case 'branch':
      // A principal held to a branch that somehow carries no location fails closed to an empty
      // board rather than widening to the whole chain.
      if (!principal.locationId) return sql`false`
      return eq(tasks.locationId, principal.locationId)
    case 'assigned':
      // Correlated EXISTS against the assignee set of the row under consideration. Expressed as a
      // fragment (not a `db`-bound subquery) so this helper stays a pure principal→predicate
      // function the data-access layer composes; `tasks.id` resolves to the outer query's row.
      return sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${principal.userId})`
    default:
      return sql`false`
  }
}
