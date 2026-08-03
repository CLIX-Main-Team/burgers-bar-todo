import { PassThrough } from 'node:stream'
import {
  type Task,
  type TaskBoardEvent,
  errorResponseSchema,
  taskBoardResponseSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { TaskBoardEvents } from '../task-board/events.js'
import type { TaskRow } from '../task-board/repository.js'
import type { TaskBoardService } from '../task-board/service.js'

export interface TaskBoardRouteDeps {
  sessionService: SessionService
  boardService: TaskBoardService
  // The in-process change bus (#132). The SSE route is its only subscriber; the write slices (B–D)
  // publish to it. Present wherever the board routes are registered.
  events: TaskBoardEvents
}

// How often an otherwise-idle connection emits a comment line, to keep proxies and load balancers
// from reaping a quiet stream. A comment (`:`-prefixed) is ignored by the EventSource parser, so it
// costs the client nothing.
const HEARTBEAT_MS = 25_000

// Map a data-access task row to its wire shape: pass every field the board renders through, and
// stringify the nullable timestamps to ISO (the repository hands back Date objects). description
// is passed verbatim — it is shown in the language it was authored in and never translated.
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    locationId: row.locationId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    position: row.position,
    assignees: row.assignees,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerTaskBoardRoutes(app: FastifyInstance, deps: TaskBoardRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The scoped board read (#131, Slice A). There is no tier-one role guard: the board is the home
  // surface every authenticated role opens, and *what* they see is decided entirely by the scope
  // predicate in the data-access layer from the fresh principal — an employee gets only their own
  // assigned tasks, a manager their whole location including the backlog, an admin the chain —
  // never from a role at the route or any query parameter. Opening the board also bumps this
  // user's last-seen marker (trigger only; the badge is #59) and reports its prior value on the
  // response, so the bump is observable through a follow-up read rather than a row peek.
  typed.get(
    '/tasks',
    {
      preHandler: requireAuth,
      schema: { response: { 200: taskBoardResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      // requireAuth guarantees principal is set before this handler runs.
      const principal = request.principal as Principal
      const board = await deps.boardService.getBoard(principal)
      return reply.code(200).send({
        tasks: board.tasks.map(toTask),
        lastSeenAt: board.lastSeenAt ? board.lastSeenAt.toISOString() : null,
      })
    },
  )

  // The live board channel (#132, Slice A2, ADR-0015) — the security core of the board. It is
  // server→client only: nothing is writable here, all writes keep travelling the guarded REST
  // endpoints, and this GET merely relays the change events those writes will publish (slices B–D).
  //
  // Auth accepts the bearer as an `access_token` query parameter as well as the header, because the
  // browser's EventSource cannot set a header and reconnects by reissuing this URL; the token is
  // validated through the identical session path, so the principal here is the same fresh one every
  // REST route resolves (ADR-0007). There is deliberately no response schema: the body is an
  // open-ended event stream, not a serialisable object, so it is piped rather than serialised.
  const requireStreamAuth = createRequireAuth(deps.sessionService, { allowQueryToken: true })

  typed.get('/tasks/stream', { preHandler: requireStreamAuth }, async (request, reply) => {
    const principal = request.principal as Principal

    const stream = new PassThrough()
    let closed = false

    // Write one frame, but never onto a stream whose client has already gone (a late-resolving
    // scope read must not throw EPIPE and take the connection down). A stream error is swallowed for
    // the same reason — a broken pipe is a disconnect, handled by cleanup, not an app failure.
    const write = (chunk: string): void => {
      if (closed) return
      stream.write(chunk)
    }
    stream.on('error', () => {})

    // For each change on the bus, re-read the task through this principal's scope and deliver it
    // only if the scope predicate admits it — the identical rule the read path applies (ADR-0007),
    // reused, not reimplemented. An out-of-scope (or now-deleted) task returns null and is withheld,
    // so a subscriber never even learns of a task that was never theirs. Re-reading at delivery time
    // is what makes a reassignment honoured live: toward this user the task arrives, away from them
    // it stops. A per-event failure is isolated so one bad read cannot drop the whole channel.
    const unsubscribe = deps.events.subscribe((change) => {
      void deps.boardService
        .getVisibleTask(principal, change.taskId)
        .then((row) => {
          if (!row) return
          const event: TaskBoardEvent = { type: 'task.upserted', task: toTask(row) }
          write(`data: ${JSON.stringify(event)}\n\n`)
        })
        .catch(() => {})
    })

    // Keep the connection warm through idle spells; unref so a pending heartbeat never holds the
    // process open (tests and graceful shutdown alike).
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
    heartbeat.unref()

    const cleanup = (): void => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      stream.end()
    }
    // The client going away (tab closed, network drop) is the end of this subscription; native SSE
    // reconnect then opens a fresh one. Bind to the raw request so cleanup fires on transport close.
    request.raw.on('close', cleanup)

    reply.header('Content-Type', 'text/event-stream')
    reply.header('Cache-Control', 'no-cache, no-transform')
    reply.header('Connection', 'keep-alive')
    // Open the stream immediately with a comment so EventSource fires `onopen` before any change.
    write(': connected\n\n')
    return reply.send(stream)
  })
}
