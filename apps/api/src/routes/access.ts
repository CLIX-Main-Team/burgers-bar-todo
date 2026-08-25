import {
  accessMatrixResponseSchema,
  errorResponseSchema,
  updateAccessRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccessService } from '../access/service.js'
import type { Principal } from '../auth/principal.js'
import {
  createRequireAuth,
  createRequireCapability,
  createRequireRole,
} from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'

// The Access surface (owner ask 2026-08-24): read the effective role-capability matrix, and
// flip one switch. Both halves are the chain owner's alone since 2026-08-25 — the page had been
// readable by everyone, on the reasoning that it only DESCRIBES the rules a person already lives
// under, and the owner's answer was that the shape of the chain's authority is his to look at.
// It rides page.access like every other page rather than a role literal, so the row it draws
// about itself is the row that governs it.

export interface AccessRouteDeps {
  sessionService: SessionService
  accessService: AccessService
}

const FORBIDDEN = { error: 'forbidden' } as const

export function registerAccessRoutes(app: FastifyInstance, deps: AccessRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)
  const requireAccessPage = createRequireCapability(deps.accessService)('page.access')

  typed.get(
    '/access',
    {
      preHandler: [requireAuth, requireAccessPage],
      schema: {
        response: {
          200: accessMatrixResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      return reply.code(200).send({
        editable: principal.role === 'super_admin',
        matrix: await deps.accessService.matrix(),
      })
    },
  )

  typed.post(
    '/access/update',
    {
      // Deliberately the bare 'super_admin' name: createRequireRole only widens 'admin' to
      // include the owner, never the other way, so branch admins stay out.
      preHandler: [requireAuth, createRequireRole('super_admin')],
      schema: {
        body: updateAccessRequestSchema,
        response: {
          200: accessMatrixResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { role, capability, allowed } = request.body
      const applied = await deps.accessService.set(role, capability, allowed)
      if (!applied) {
        return reply.code(403).send(FORBIDDEN)
      }
      // Answer with the whole fresh matrix, so the page repaints from the server's truth
      // rather than trusting its optimistic flip.
      return reply.code(200).send({ editable: true, matrix: await deps.accessService.matrix() })
    },
  )
}
