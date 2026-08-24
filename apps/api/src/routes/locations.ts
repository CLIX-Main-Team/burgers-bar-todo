import {
  createLocationRequestSchema,
  errorResponseSchema,
  locationDeleteResponseSchema,
  locationIdParamsSchema,
  locationListResponseSchema,
  locationSchema,
  updateLocationRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccessService } from '../access/service.js'
import { createRequireAuth, createRequireCapability } from '../auth/require-auth.js'
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
  // The role-capability answers (owner ask 2026-08-24) the guards below consult.
  accessService: AccessService
}

// The two failures this surface names. `not_found` is a rename or delete of an id that does not
// exist — there is nothing to hide here (the whole table is an admin's to see), so it is a plain
// 404, not the non-enumerating one the location-scoped board writes use. `location_in_use` is a
// delete of a branch that still has people or tasks on it: the caller is told exactly why, because
// the fix is theirs to make (move them, then delete). A non-admin never reaches a handler — the
// tier-one role guard answers `forbidden`; a blank name is refused by the request schema before the
// handler runs.
const NOT_FOUND = { error: 'not_found' } as const
const IN_USE = { error: 'location_in_use' } as const

export function registerLocationRoutes(app: FastifyInstance, deps: LocationRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The tier-one capability guards (ADR-0007, recut 2026-08-24): writes gate on
  // locations.manage, the list read on holding EITHER the Locations page or the manage power
  // (the pickers that consume the list ride the same read). Both default to admin-only, and
  // both are the owner's to widen from the Access page. There is no scope beneath them.
  const requireCapability = createRequireCapability(deps.accessService)
  const requireLocationsManage = requireCapability('locations.manage')
  const requireLocationsRead = requireCapability('page.locations', 'locations.manage')

  // List every Location, ordered by name (#164). The single authoritative list that retires the
  // "distinct locationIds from the people list" hack in both UI consumers (L2/L3).
  typed.get(
    '/locations',
    {
      preHandler: [requireAuth, requireLocationsRead],
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
      preHandler: [requireAuth, requireLocationsManage],
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
      preHandler: [requireAuth, requireLocationsManage],
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

  // Delete a Location by id (owner ask 2026-08-16). POST, the repo's convention for a state change
  // (mirroring the task and thread deletes). A branch is only removable once it is empty: while a
  // user or a task still references it the answer is 409 `location_in_use`, so the people and the
  // work are never orphaned by a click. The emptiness check and the delete share one transaction in
  // the repository, so the guard cannot be raced.
  typed.post(
    '/locations/:id/delete',
    {
      preHandler: [requireAuth, requireLocationsManage],
      schema: {
        params: locationIdParamsSchema,
        response: {
          200: locationDeleteResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const outcome = await deps.locationRepository.deleteLocation(request.params.id)
      if (outcome === 'not_found') {
        return reply.code(404).send(NOT_FOUND)
      }
      if (outcome === 'in_use') {
        return reply.code(409).send(IN_USE)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
