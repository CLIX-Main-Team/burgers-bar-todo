import {
  type ProjectChecklistItem,
  type ProjectSummary,
  addChecklistItemRequestSchema,
  checklistItemParamsSchema,
  checklistMutationResponseSchema,
  createProjectRequestSchema,
  errorResponseSchema,
  projectDeleteResponseSchema,
  projectDetailResponseSchema,
  projectIdParamsSchema,
  projectListResponseSchema,
  projectSummarySchema,
  setChecklistItemRequestSchema,
  updateProjectRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { ChecklistItemRow, ProjectRow } from '../projects/repository.js'
import { type ProjectService, deriveStatus } from '../projects/service.js'

export interface ProjectRouteDeps {
  sessionService: SessionService
  projectService: ProjectService
}

const FORBIDDEN = { error: 'forbidden' } as const
const NOT_FOUND = { error: 'not_found' } as const

// Map a project row to its wire shape. status is computed here from the checklist counts rather
// than read from a column, because there is no column — see db/schema.ts for why.
function toProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    // icon, colour, roles and phase are stored as plain text and validated by the response schema
    // on the way out, so a hand-edited row carrying a retired value fails loudly here rather than
    // rendering as a blank square in the client.
    icon: row.icon as ProjectSummary['icon'],
    colour: row.colour as ProjectSummary['colour'],
    roles: row.roles as ProjectSummary['roles'],
    locations: row.locations,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    targetDate: row.targetDate ? row.targetDate.toISOString() : null,
    phase: row.phase as ProjectSummary['phase'],
    doneCount: row.doneCount,
    taskCount: row.taskCount,
    status: deriveStatus(row.doneCount, row.taskCount),
    createdBy: row.creator,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toChecklistItem(row: ChecklistItemRow): ProjectChecklistItem {
  return { id: row.id, title: row.title, done: row.done, position: row.position }
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)

  // The WRITE guard, not a read guard. Since the owner's 2026-08-23 call that a project's roles
  // decide who it is for, an employee genuinely has a projects view — the ones naming their role —
  // so the reads carry no tier-one role guard at all and are scoped purely by the predicate, the
  // same way the board is. What an employee still cannot do is create, rename or delete a project,
  // or tick somebody else's checklist: those remain manager-and-up.
  // Every role this surface admits, named in full. Until 2026-08-23 the guard silently widened
  // 'admin' to cover 'super_admin' as well; that expansion is gone now the two roles differ, so
  // an unnamed super_admin would be refused its own chain's projects.
  const requireManagerOrAdmin = createRequireRole('super_admin', 'admin', 'manager')

  typed.get(
    '/projects',
    {
      preHandler: requireAuth,
      schema: {
        response: { 200: projectListResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const rows = await deps.projectService.list(principal)
      return reply.code(200).send({ projects: rows.map(toProject) })
    },
  )

  typed.get(
    '/projects/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: projectIdParamsSchema,
        response: {
          200: projectDetailResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const view = await deps.projectService.get(principal, request.params.id)
      if (!view) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send({
        project: toProject(view.project),
        checklist: view.checklist.map(toChecklistItem),
      })
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
        roles: body.roles,
        locationIds: body.locationIds,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        phase: body.phase,
        checklist: body.checklist,
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
        locationIds: body.locationIds,
        roles: body.roles,
        startDate: body.startDate ? new Date(body.startDate) : null,
        targetDate: body.targetDate ? new Date(body.targetDate) : null,
        phase: body.phase,
      })
      // A project the caller cannot see is a 404, but naming a branch they may not reach is a
      // 403: they are looking at a project they are allowed to look at and asking for something
      // they are not allowed to ask for, and calling that "not found" would be a lie.
      if (!result.ok) {
        return result.reason === 'forbidden'
          ? reply.code(403).send(FORBIDDEN)
          : reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(toProject(result.project))
    },
  )

  // Deleting a project takes its checklist with it (the FK cascades) but leaves any board task
  // that referenced it on the board, unfiled. Losing a grouping must never lose real work.
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

  // --- the checklist ---
  //
  // Every one of these answers with the WHOLE project plus its checklist, not the item alone,
  // because ticking an item can move the project's phase to (or off) `completed`. Returning just
  // the item would leave the client to guess whether the phase moved and refetch to find out.

  typed.post(
    '/projects/:id/checklist',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: projectIdParamsSchema,
        body: addChecklistItemRequestSchema,
        response: {
          201: checklistMutationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.projectService.addChecklistItem(
        principal,
        request.params.id,
        request.body.title,
      )
      if (!result.ok) return reply.code(404).send(NOT_FOUND)
      return reply.code(201).send(viewToBody(result.view))
    },
  )

  typed.post(
    '/projects/:id/checklist/:itemId',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: checklistItemParamsSchema,
        body: setChecklistItemRequestSchema,
        response: {
          200: checklistMutationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.projectService.setChecklistItemDone(
        principal,
        request.params.id,
        request.params.itemId,
        request.body.done,
      )
      if (!result.ok) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send(viewToBody(result.view))
    },
  )

  typed.post(
    '/projects/:id/checklist/:itemId/delete',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: checklistItemParamsSchema,
        response: {
          200: checklistMutationResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.projectService.removeChecklistItem(
        principal,
        request.params.id,
        request.params.itemId,
      )
      if (!result.ok) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send(viewToBody(result.view))
    },
  )
}

function viewToBody(view: { project: ProjectRow; checklist: ChecklistItemRow[] }) {
  return { project: toProject(view.project), checklist: view.checklist.map(toChecklistItem) }
}
