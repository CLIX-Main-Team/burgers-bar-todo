import {
  type KnowledgeDocListResponse,
  errorResponseSchema,
  knowledgeDocListResponseSchema,
  resyncKnowledgeResponseSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccessService } from '../access/service.js'
import type { KnowledgeScope } from '../assistant/document-metadata.js'
import { type Principal, viewScope } from '../auth/principal.js'
import { createRequireAuth, createRequireCapability } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'

// The assistant's authenticated surface: the manual "resync now" endpoint (#89, ADR-0014) — the
// "I just changed the policy, make it live now" action — and the Knowledge tab's listing read
// (ADR-0024). Both gate on capabilities the owner edits from the Access page (2026-08-24),
// defaulting to manager-and-up, enforced through the ADR-0007 API-layer path.

export interface AssistantRouteDeps {
  // The session service the shared guards resolve the bearer against (ADR-0007). Passed rather
  // than the guards themselves so this module owns its own guard wiring, as the auth routes do.
  sessionService: SessionService
  // The role-capability answers (owner ask 2026-08-24) the guards below consult.
  accessService: AccessService
  // Reconcile the knowledge cache against Drive and resolve once it is current — the manual
  // resync trigger (SyncTriggers.resyncNow). Awaited by the handler, so the response is sent
  // only after a just-changed doc is answerable.
  resync(): Promise<void>
  // The Knowledge tab's one read (ADR-0024): every cached doc's filing metadata plus the last
  // sync time, already in wire shape. Composed outside (server.ts / the harness) over the
  // knowledge repository, so the route owns HTTP and guards, never data access.
  listKnowledgeDocs(scope: KnowledgeScope): Promise<KnowledgeDocListResponse>
}

export function registerAssistantRoutes(app: FastifyInstance, deps: AssistantRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)
  const requireCapability = createRequireCapability(deps.accessService)

  // Resync the knowledge cache now (#89). Manager/admin only — a policy author's "make it live"
  // action — so the tier-one guard admits admin and manager and refuses an employee with a flat
  // 403 (ADR-0007). The handler awaits the single-flight reconcile and answers with an
  // acknowledgement; the refreshed knowledge cache is observed through the assistant's
  // grounding reads.
  typed.post(
    '/assistant/resync',
    {
      preHandler: [requireAuth, requireCapability('knowledge.sync')],
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

  // The Knowledge tab's listing (ADR-0024): every Knowledge Doc's filing metadata — shelf,
  // status, skip reason, Drive id for the open-in-Drive link — plus the last sync time.
  // Manager/admin only, the same tier the resync above admits: the tab is the corpus's
  // management surface, and an employee meets the assistant's answers, never its filing.
  typed.get(
    '/assistant/knowledge',
    {
      preHandler: [requireAuth, requireCapability('page.knowledge')],
      schema: {
        response: {
          200: knowledgeDocListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      return reply.code(200).send(
        await deps.listKnowledgeDocs({
          role: principal.role,
          view: viewScope(principal, 'knowledge.view'),
        }),
      )
    },
  )
}
