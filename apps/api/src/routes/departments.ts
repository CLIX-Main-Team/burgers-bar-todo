import { departmentListResponseSchema, errorResponseSchema } from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { DepartmentRepository } from '../departments/repository.js'

// The departments read (owner ask 2026-09-20): the chain's seven, in order, for the invite
// picker, the roster and the Tasks page's chips. Authentication is the only gate: the list is a
// fact about the chain every signed-in person may know, and what they may see INSIDE a department
// is the tasks.departments scope's business, applied where tasks are read.
export interface DepartmentRouteDeps {
  sessionService: SessionService
  departmentRepository: DepartmentRepository
}

export function registerDepartmentRoutes(app: FastifyInstance, deps: DepartmentRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)

  typed.get(
    '/departments',
    {
      preHandler: [requireAuth],
      schema: {
        response: {
          200: departmentListResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const departments = await deps.departmentRepository.listDepartments()
      return reply.code(200).send({ departments })
    },
  )
}
