import {
  createLocationRequestSchema,
  errorResponseSchema,
  locationIdParamsSchema,
  locationListResponseSchema,
  locationSchema,
  updateLocationRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { LocationRepository } from '../locations/repository.js'

// The admin locations API (#164, Slice L1). Every route here is Admin-only and re-authorises the
// principal server-side (ADR-0007) — no UI gating is trusted, so a Manager or Employee is a flat 403
// on all three. The whole surface is scope-free: an admin holds no location of their own and sees
// the entire table, so there is no tier-two predicate, only the tier-one admin gate. The repository
// is the deep module the routes sit on directly — its three methods map one-to-one to the three
// operations, so no pass-through service is interposed.
export interface LocationRouteDeps {
  sessionService: SessionService
  locationRepository: LocationRepository
}

// The one failure this surface names: a rename of an id that does not exist. There is nothing to
// hide here (the whole table is an admin's to see), so it is a plain not_found, not the
// non-enumerating 404 the location-scoped board writes use. A non-admin never reaches a handler —
// the tier-one role guard answers `forbidden`; a blank name is refused by the request schema before
// the handler runs.
const NOT_FOUND = { error: 'not_found' } as const

export function registerLocationRoutes(app: FastifyInstance, deps: LocationRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The tier-one coarse role guard (ADR-0007): creating, renaming, or listing a Location is a
  // chain/HQ act, so only an admin passes — a manager acts within their one Location, an employee
  // never. This is the whole of authorisation on this surface; there is no scope beneath it.
  const requireAdmin = createRequireRole('admin')

  // List every Location, ordered by name (#164). The single authoritative list that retires the
  // "distinct locationIds from the people list" hack in both UI consumers (L2/L3).
  typed.get(
    '/locations',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        response: {
          200: locationListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const locations = await deps.locationRepository.listLocations()
      return reply.code(200).send({ locations })
    },
  )

  // Create a Location from a name (#164). No uniqueness check and no duplicate rejection —
  // same-name branches are legitimate (decision 5); the soft "already exists" warning is a UI
  // concern in L2/L3. The created row comes back.
  typed.post(
    '/locations',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        body: createLocationRequestSchema,
        response: {
          201: locationSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const location = await deps.locationRepository.createLocation({ name: request.body.name })
      return reply.code(201).send(location)
    },
  )

  // Rename a Location by id (#164). Everything references a Location by id, so a rename ripples
  // nowhere. An id that does not exist is a plain 404; the updated row rides back on success.
  typed.patch(
    '/locations/:id',
    {
      preHandler: [requireAuth, requireAdmin],
      schema: {
        params: locationIdParamsSchema,
        body: updateLocationRequestSchema,
        response: {
          200: locationSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const location = await deps.locationRepository.renameLocation(
        request.params.id,
        request.body.name,
      )
      if (!location) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(location)
    },
  )
}
