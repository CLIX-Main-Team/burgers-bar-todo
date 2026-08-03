import {
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
  createThreadRequestSchema,
  errorResponseSchema,
  threadDetailSchema,
  threadIdParamsSchema,
  threadListResponseSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { MessageRow, ThreadRow, ThreadWithMessages } from '../assistant/thread-repository.js'
import type { ThreadService } from '../assistant/thread-service.js'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'

// The assistant thread routes (#90): a signed-in user starts a thread, lists their own threads,
// and opens one with its full history. Every route is behind requireAuth and reads the owner
// from the resolved principal, never from the body or path — so a thread is created for, listed
// for, and opened by its author alone (author-scoped reads, ADR-0007). There is no route that
// inserts a message with a caller-supplied role: create writes a `user` turn through the
// assistant service, so an `agent` voice cannot be forged from the browser (ADR-0003).

export interface ThreadRouteDeps {
  // Resolves the bearer to the principal on every request (the shared requireAuth pre-handler).
  sessionService: SessionService
  // The assistant service that owns thread creation, the message write, and the scoped reads.
  threadService: ThreadService
}

// The one non-enumerating 404 the open endpoint returns for any thread the caller may not read —
// an unknown id and another user's thread are indistinguishable, so opening an id never confirms
// the row exists.
const NOT_FOUND = { error: 'not_found' } as const

// Map a thread row to its response shape, stamping the timestamps as ISO 8601 strings the shared
// contract carries.
const toThreadSummary = (thread: ThreadRow): ThreadSummary => ({
  id: thread.id,
  title: thread.title,
  createdAt: thread.createdAt.toISOString(),
  updatedAt: thread.updatedAt.toISOString(),
})

const toThreadMessage = (message: MessageRow): ThreadMessage => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
})

// A thread with its turns, in the detail shape create and open both return.
const toThreadDetail = (detail: ThreadWithMessages): ThreadDetail => ({
  ...toThreadSummary(detail.thread),
  messages: detail.messages.map(toThreadMessage),
})

export function registerThreadRoutes(app: FastifyInstance, deps: ThreadRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)

  // Start a thread (#90): the client supplies only the first user message. The owner is the
  // principal, the title is derived server-side from the message, and the first turn is written
  // as `user` inside the assistant service — the sole message-write path, which cannot name the
  // role. Returns the new thread with its first turn.
  typed.post(
    '/threads',
    {
      preHandler: requireAuth,
      schema: {
        body: createThreadRequestSchema,
        response: {
          201: threadDetailSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const detail = await deps.threadService.createThread(principal.userId, request.body.content)
      return reply.code(201).send(toThreadDetail(detail))
    },
  )

  // List my threads (#90), most-recently-active first. The scope is the principal's own user id,
  // derived in the data-access layer — never a query parameter — so a user sees only their own
  // threads, with no manager or admin override.
  typed.get(
    '/threads',
    {
      preHandler: requireAuth,
      schema: {
        response: {
          200: threadListResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const threads = await deps.threadService.listThreads(principal.userId)
      return reply.code(200).send({ threads: threads.map(toThreadSummary) })
    },
  )

  // Open one of my threads with its full history (#90). The thread is resolved scoped to the
  // principal, so another user's id — or an unknown one — resolves nothing and returns the same
  // non-enumerating 404: a thread is invisible to anyone but its author (ADR-0007).
  typed.get(
    '/threads/:id',
    {
      preHandler: requireAuth,
      schema: {
        params: threadIdParamsSchema,
        response: {
          200: threadDetailSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const detail = await deps.threadService.getThread(principal.userId, request.params.id)
      if (!detail) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(toThreadDetail(detail))
    },
  )
}
