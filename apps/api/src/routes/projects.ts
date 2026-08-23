import {
  type ProjectSummary,
  createProjectRequestSchema,
  errorResponseSchema,
  projectDeleteResponseSchema,
  projectDetailResponseSchema,
  projectIdParamsSchema,
  projectListResponseSchema,
  projectSummarySchema,
  updateProjectRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { ProjectRow } from '../projects/repository.js'
import { type ProjectService, deriveStatus } from '../projects/service.js'
import type { TaskBoardService } from '../task-board/service.js'
import { toTask } from './task-board.js'

export interface ProjectRouteDeps {
  sessionService: SessionService
  projectService: ProjectService
  // The board read, reused verbatim to answer "which tasks are in this project". The project
  // screens show the SAME task rows the kanban does — filtered here rather than re-queried — so
  // the two surfaces can never disagree about a task's status, assignees or priority.
  boardService: TaskBoardService
}

const FORBIDDEN = { error: 'forbidden' } as const
const NOT_FOUND = { error: 'not_found' } as const

// Map a project row to its wire shape. status is computed here from the counts rather than read
// from a column, because there is no column — see db/schema.ts for why.
function toProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    // icon and colour are stored as plain text and validated by the response schema on the way
    // out, so a hand-edited row carrying a retired icon fails loudly here rather than rendering
    // as a blank square in the client.
    icon: row.icon as ProjectSummary['icon'],
    colour: row.colour as ProjectSummary['colour'],
    locationId: row.locationId,
    locationName: row.locationName,
    lead: row.lead,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    targetDate: row.targetDate ? row.targetDate.toISOString() : null,
    phase: row.phase,
    doneCount: row.doneCount,
    taskCount: row.taskCount,
    status: deriveStatus(row.doneCount, row.taskCount),
    team: row.team,
    createdBy: row.creator,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)

  // Projects is a manager-and-up surface, matching the SPA's own route guard. Unlike the board —
  // which every role opens and which is scoped purely by predicate — an employee has no project
  // view at all in v1, so the coarse role guard is the honest expression of that, and the scope
  // predicate behind it fails closed for any other role regardless (projects/scope.ts).
  const requireManagerOrAdmin = createRequireRole('admin', 'manager')

  typed.get(
    '/projects',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        response: {
          200: projectListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const rows = await deps.projectService.list(principal)
      return reply.code(200).send({ projects: rows.map(toProject) })
    },
  )

  // One project and its tasks. The tasks come from the board read filtered by project id, so they
  // arrive already scoped to what this principal may see and in the board's shared manual order.
  typed.get(
    '/projects/:id',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: projectIdParamsSchema,
        response: {
          200: projectDetailResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const project = await deps.projectService.get(principal, request.params.id)
      if (!project) return reply.code(404).send(NOT_FOUND)
      // Peek, never bump: opening a project is not opening the board, and it must not clear the
      // Tasks tab's unseen badge on the way past.
      const board = await deps.boardService.getBoard(principal, { peek: true })
      const tasks = board.tasks.filter((task) => task.projectId === project.id)
      return reply.code(200).send({ project: toProject(project), tasks: tasks.map(toTask) })
    },
  )

  typed.post(
    '/projects',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        body: createProjectRequestSchema,
        response: {
          201: projectSummarySchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const body = request.body
      const result = await deps.projectService.create(principal, {
        name: body.name,
        icon: body.icon,
        colour: body.colour,
        locationId: body.locationId ?? null,
        leadId: body.leadId ?? null,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        phase: body.phase ?? null,
      })
      if (!result.ok) return reply.code(403).send(FORBIDDEN)
      return reply.code(201).send(toProject(result.project))
    },
  )

  // POST rather than PUT, and a verb in the path rather than the HTTP method: the repo's own
  // convention for a state change (see the task writes), kept so the two surfaces read alike.
  typed.post(
    '/projects/:id/update',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: projectIdParamsSchema,
        body: updateProjectRequestSchema,
        response: {
          200: projectSummarySchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const body = request.body
      const result = await deps.projectService.update(principal, request.params.id, {
        name: body.name,
        icon: body.icon,
        colour: body.colour,
        leadId: body.leadId,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        phase: body.phase,
      })
      if (!result.ok) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send(toProject(result.project))
    },
  )

  // Deleting a project leaves its tasks on the board, unfiled (the FK is `set null`). Losing a
  // grouping must never lose the work.
  typed.post(
    '/projects/:id/delete',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: projectIdParamsSchema,
        response: {
          200: projectDeleteResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.projectService.remove(principal, request.params.id)
      if (!result.ok) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
