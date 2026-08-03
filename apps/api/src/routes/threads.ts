import {
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
  createThreadRequestSchema,
  errorResponseSchema,
  postThreadMessageRequestSchema,
  threadDetailSchema,
  threadIdParamsSchema,
  threadListResponseSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AnswerService } from '../assistant/answer-service.js'
import type { MessageRow, ThreadRow, ThreadWithMessages } from '../assistant/thread-repository.js'
import type { ThreadService } from '../assistant/thread-service.js'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'

// The assistant thread routes (#90, #91): a signed-in user starts a thread, lists their own threads,
// opens one with its full history, and — once the answer path is wired (#91) — posts a question to
// one and gets a synchronous, procedure-grounded answer. Every route is behind requireAuth and reads
// the owner from the resolved principal, never from the body or path — so a thread is created for,
// listed for, opened by, and answered for its author alone (author-scoped reads, ADR-0007). No route
// accepts a caller-supplied role: create writes a `user` turn and the answer path writes the `user`
// question and the `agent` reply through the service, so an `agent` voice cannot be forged from the
// browser (ADR-0003).

export interface ThreadRouteDeps {
  // Resolves the bearer to the principal on every request (the shared requireAuth pre-handler).
  sessionService: SessionService
  // The assistant service that owns thread creation, the message write, and the scoped reads.
  threadService: ThreadService
  // The grounded answer path (#91), present when the assistant LLM is wired (the running server and
  // the answer harness) and absent in the threads-only persistence harness (#90). When present it
  // enables POST /threads/:id/messages; its absence is why that route 404s in a threads-only boot,
  // so the persistence slice exposes no message-write path on its own.
  answerService?: AnswerService
}

// The one non-enumerating 404 the open and answer endpoints return for any thread the caller may not
// read — an unknown id and another user's thread are indistinguishable, so acting on an id never
// confirms the row exists.
const NOT_FOUND = { error: 'not_found' } as const

// The retryable failure the answer endpoint returns when the LLM call fails (timeout, non-2xx,
// malformed): a transient hiccup the client retries in place, with nothing persisted (ADR-0003).
const ASSISTANT_UNAVAILABLE = { error: 'assistant_unavailable' } as const

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

  // Post a question to one of my threads and get a synchronous, procedure-grounded answer (#91,
  // ADR-0003). Registered only when the answer path is wired, so the threads-only persistence slice
  // exposes no message-write route. The body carries only the question content — a role can never be
  // supplied, so a client cannot forge an `agent` turn (ADR-0003): the question is written as a
  // `user` turn and the answer as the sole `agent` turn, both by the service. A thread that is not
  // the caller's is the same non-enumerating 404 as opening it; a model failure is a retryable 503
  // with nothing persisted, so the client retries the question in place (story 8).
  if (deps.answerService) {
    const answerService = deps.answerService
    typed.post(
      '/threads/:id/messages',
      {
        preHandler: requireAuth,
        schema: {
          params: threadIdParamsSchema,
          body: postThreadMessageRequestSchema,
          response: {
            201: threadDetailSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            404: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const principal = request.principal as Principal
        const outcome = await answerService.answer(
          principal.userId,
          request.params.id,
          request.body.content,
        )
        if (outcome.status === 'not_found') {
          return reply.code(404).send(NOT_FOUND)
        }
        if (outcome.status === 'unavailable') {
          return reply.code(503).send(ASSISTANT_UNAVAILABLE)
        }
        return reply.code(201).send(toThreadDetail(outcome.detail))
      },
    )
  }
}
