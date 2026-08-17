import {
  deviceAcknowledgementSchema,
  errorResponseSchema,
  registerDeviceRequestSchema,
  unregisterDeviceRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { PushDeviceRepository } from '../notifications/repository.js'

// The device-registration surface (#59 delivery side): the two calls a wrapper app makes to say
// "this phone is mine now" and "it is not any more". Both are authenticated and neither takes a
// user id — the owner is always the bearer's principal, so a device can only ever be claimed for,
// or released from, the account actually holding the session.
//
// No role guard: every signed-in person receives their own task assignments, so this is the one
// write surface open to an employee as well as a manager and an admin.

export interface DeviceRouteDeps {
  sessionService: SessionService
  pushDevices: PushDeviceRepository
}

export function registerDeviceRoutes(app: FastifyInstance, deps: DeviceRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)

  // Register or refresh this device. Called on every authenticated app start, not only at
  // sign-in — push tokens rotate, and re-sending the current one is how the server's copy stays
  // live for staff who sign in once and never sign out again.
  typed.post(
    '/devices',
    {
      preHandler: requireAuth,
      schema: {
        body: registerDeviceRequestSchema,
        response: { 200: deviceAcknowledgementSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const { token, platform } = request.body
      await deps.pushDevices.register({ token, userId: principal.userId, platform })
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Release this device on sign-out, so a phone that changes hands stops ringing for whoever left
  // it. A token that is not this user's is simply not deleted, and the call still answers ok: the
  // client has already dropped its own copy either way, and a distinguishable refusal would turn
  // this into a way to probe whether a guessed token exists.
  typed.post(
    '/devices/unregister',
    {
      preHandler: requireAuth,
      schema: {
        body: unregisterDeviceRequestSchema,
        response: { 200: deviceAcknowledgementSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      await deps.pushDevices.unregister(request.body.token, principal.userId)
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
