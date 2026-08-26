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
import { type Principal, viewScope } from '../auth/principal.js'
import {
  createRequireAuth,
  createRequireCapability,
  createRequireRole,
} from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { LocationRepository } from '../locations/repository.js'

// The admin locations API (#164, Slice L1). Every route here is admin-level-only and re-authorises
// the principal server-side (ADR-0007) — no UI gating is trusted, so a Manager or Employee is a
// flat 403 on all four. Reading and editing a branch is admin-level work (2026-08-23): both admin
// roles pass the tier-one gate, and the tier-two `LocationScope` predicate (in the repository)
// narrows what they see and touch to their own branch, a super_admin's reach being the whole
// table. Creating and deleting a branch is a chain act, reserved to super_admin alone. The
// repository is the deep module the routes sit on directly — its four methods map one-to-one to
// the four operations, so no pass-through service is interposed.
export interface LocationRouteDeps {
  sessionService: SessionService
  locationRepository: LocationRepository
  // The role-capability answers (owner ask 2026-08-24) the guards below consult.
  accessService: AccessService
}

// The two failures this surface names. `not_found` is a rename of an id that does not exist, or —
// since 2026-08-23 — one that exists outside the caller's scope: the two are answered identically
// on purpose, because telling a branch admin "forbidden" on someone else's branch would confirm it
// exists and let them map the chain by walking ids. `location_in_use` is a delete of a branch that
// still has people or tasks on it: the caller is told exactly why, because the fix is theirs to
// make (move them, then delete) — delete is super_admin-only, so this case never carries the same
// scope ambiguity. A caller outside the tier-one gate never reaches a handler — the role guard
// answers `forbidden`; a blank name is refused by the request schema before the handler runs.
const NOT_FOUND = { error: 'not_found' } as const
const IN_USE = { error: 'location_in_use' } as const
// A branch a project runs at is refused for its own reason (2026-08-24). The fix is on the
// Projects screen, not this one, so the caller is told which screen to go to rather than being
// sent looking for staff and tasks that are not there.
const IN_PROJECT = { error: 'location_in_project' } as const

export function registerLocationRoutes(app: FastifyInstance, deps: LocationRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The tier-one guards (ADR-0007, recut 2026-08-24, over the 2026-08-23 branch-admin split):
  // the list read gates on holding EITHER the Locations page or the manage power (the pickers
  // that consume the list ride the same read), and editing a branch gates on locations.manage —
  // both capabilities the owner may widen from the Access page, with the tier-two LocationScope
  // in the repository still narrowing what a branch-holder sees and touches to their own branch.
  // Creating and deleting a branch stays a chain act reserved to super_admin regardless of the
  // switches: a switch gates yes/no, and no role's nature but the owner's spans the chain.
  const requireCapability = createRequireCapability(deps.accessService)
  const requireLocationsManage = requireCapability('locations.manage')
  const requireLocationsRead = requireCapability('page.locations', 'locations.manage')
  const requireSuperAdmin = createRequireRole('super_admin')

  // List the Locations the caller's scope reaches, ordered by name (#164; scoped 2026-08-23). The
  // single authoritative list that retires the "distinct locationIds from the people list" hack in
  // both UI consumers (L2/L3) — the whole table for a super_admin, one branch for a branch admin.
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
    async (request, reply) => {
      const principal = request.principal as Principal
      const locations = await deps.locationRepository.listLocations({
        role: principal.role,
        locationId: principal.locationId,
        view: viewScope(principal, 'locations.view'),
      })
      return reply.code(200).send({ locations })
    },
  )

  // Create a Location from a name (#164). Chain-wide, so super_admin only (2026-08-23): a branch
  // admin has nowhere of their own to put a new branch under. No uniqueness check and no duplicate
  // rejection — same-name branches are legitimate (decision 5); the soft "already exists" warning
  // is a UI concern in L2/L3. The created row comes back.
  typed.post(
    '/locations',
    {
      preHandler: [requireAuth, requireSuperAdmin],
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

  // Patch a Location by id (#164; widened to address/city/phone 2026-08-24). request.body is
  // passed straight through as the patch: a key the editor never sent is absent from the body
  // object and therefore untouched, an explicit null clears that column, and the repository is
  // what tells the two apart. Everything references a Location by id, so a patch ripples nowhere.
  // An id outside the caller's scope — unknown, or a real branch that is not theirs — is a plain
  // 404 either way (2026-08-23); the updated row rides back on success.
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
      const principal = request.principal as Principal
      const location = await deps.locationRepository.updateLocation(
        request.params.id,
        request.body,
        {
          role: principal.role,
          locationId: principal.locationId,
          view: viewScope(principal, 'locations.view'),
        },
      )
      if (!location) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(location)
    },
  )

  // Delete a Location by id (owner ask 2026-08-16). Chain-wide, so super_admin only (2026-08-23):
  // removing a branch outright is not a call a single branch's admin gets to make. POST, the repo's
  // convention for a state change (mirroring the task and thread deletes). A branch is only
  // removable once it is empty: while a user or a task still references it the answer is 409
  // `location_in_use`, so the people and the work are never orphaned by a click. The emptiness
  // check and the delete share one transaction in the repository, so the guard cannot be raced.
  typed.post(
    '/locations/:id/delete',
    {
      preHandler: [requireAuth, requireSuperAdmin],
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
      if (outcome === 'in_project') {
        return reply.code(409).send(IN_PROJECT)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
