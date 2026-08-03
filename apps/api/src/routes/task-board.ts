import { type Task, errorResponseSchema, taskBoardResponseSchema } from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { TaskRow } from '../task-board/repository.js'
import type { TaskBoardService } from '../task-board/service.js'

export interface TaskBoardRouteDeps {
  sessionService: SessionService
  boardService: TaskBoardService
}

// Map a data-access task row to its wire shape: pass every field the board renders through, and
// stringify the nullable timestamps to ISO (the repository hands back Date objects). description
// is passed verbatim — it is shown in the language it was authored in and never translated.
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    locationId: row.locationId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    position: row.position,
    assignees: row.assignees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerTaskBoardRoutes(app: FastifyInstance, deps: TaskBoardRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The scoped board read (#131, Slice A). There is no tier-one role guard: the board is the home
  // surface every authenticated role opens, and *what* they see is decided entirely by the scope
  // predicate in the data-access layer from the fresh principal — an employee gets only their own
  // assigned tasks, a manager their whole location including the backlog, an admin the chain —
  // never from a role at the route or any query parameter. Opening the board also bumps this
  // user's last-seen marker (trigger only; the badge is #59) and reports its prior value on the
  // response, so the bump is observable through a follow-up read rather than a row peek.
  typed.get(
    '/tasks',
    {
      preHandler: requireAuth,
      schema: { response: { 200: taskBoardResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      // requireAuth guarantees principal is set before this handler runs.
      const principal = request.principal as Principal
      const board = await deps.boardService.getBoard(principal)
      return reply.code(200).send({
        tasks: board.tasks.map(toTask),
        lastSeenAt: board.lastSeenAt ? board.lastSeenAt.toISOString() : null,
      })
    },
  )
}
