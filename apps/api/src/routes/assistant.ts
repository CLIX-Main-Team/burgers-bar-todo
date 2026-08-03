import { errorResponseSchema, resyncKnowledgeResponseSchema } from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'

// The assistant's authenticated surface. In this slice it is the one manual "resync now" endpoint
// (#89, ADR-0014) — the "I just changed the policy, make it live now" action — enforced through
// the ADR-0007 API-layer path: requireAuth then requireRole('admin', 'manager'), so an employee is
// refused. The grounded answer path is a later slice that registers its routes here too.

export interface AssistantRouteDeps {
  // The session service the shared guards resolve the bearer against (ADR-0007). Passed rather
  // than the guards themselves so this module owns its own guard wiring, as the auth routes do.
  sessionService: SessionService
  // Reconcile the knowledge cache against Drive and resolve once it is current — the manual
  // resync trigger (SyncTriggers.resyncNow). Awaited by the handler, so the response is sent
  // only after a just-changed doc is answerable.
  resync(): Promise<void>
}

export function registerAssistantRoutes(app: FastifyInstance, deps: AssistantRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)
  const requireRole = createRequireRole

  // Resync the knowledge cache now (#89). Manager/admin only — a policy author's "make it live"
  // action — so the tier-one guard admits admin and manager and refuses an employee with a flat
  // 403 (ADR-0007). The handler awaits the single-flight reconcile and answers with an
  // acknowledgement; the refreshed knowledge cache is observed through the assistant's
  // grounding reads.
  typed.post(
    '/assistant/resync',
    {
      preHandler: [requireAuth, requireRole('admin', 'manager')],
      schema: {
        response: {
          200: resyncKnowledgeResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      await deps.resync()
      return reply.code(200).send({ status: 'ok' })
    },
  )
}
