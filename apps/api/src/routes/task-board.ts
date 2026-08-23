import { PassThrough } from 'node:stream'
import {
  type Task,
  type TaskBoardEvent,
  createTaskRequestSchema,
  errorResponseSchema,
  reorderTasksRequestSchema,
  reorderTasksResponseSchema,
  taskBoardQuerySchema,
  taskBoardResponseSchema,
  taskBoardSeenResponseSchema,
  taskDeleteResponseSchema,
  taskIdParamsSchema,
  taskSchema,
  updateTaskRequestSchema,
  updateTaskStatusRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Principal } from '../auth/principal.js'
import { createRequireAuth, createRequireRole } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { TaskBoardEvents } from '../task-board/events.js'
import type { TaskRow } from '../task-board/repository.js'
import type { TaskBoardService } from '../task-board/service.js'
import type { TaskWriteService } from '../task-board/task-write-service.js'

export interface TaskBoardRouteDeps {
  sessionService: SessionService
  boardService: TaskBoardService
  // The manager/admin write surface (#133, Slice B): create, full-update (edit + reassign), delete.
  // The route enforces tier one (role) and the service enforces tier two (scope) plus the
  // assignee-location invariant. Present wherever the board routes are registered.
  writeService: TaskWriteService
  // The in-process change bus (#132). The SSE route is its only subscriber; the write slices (B–D)
  // publish to it through the write service. Present wherever the board routes are registered.
  events: TaskBoardEvents
}

// The board-write failures, one flat shape each so a rejection never leaks structure. `forbidden` is
// a board the principal may not write (a manager past their location); `invalid_request` is a
// malformed create for the principal's own remit (an admin naming no location) or a cross-location
// assignee (the assignee-location invariant); `not_found` is any by-id write on a task outside the
// principal's write scope — unknown or another location's — so acting on an id never confirms it
// exists elsewhere.
const FORBIDDEN = { error: 'forbidden' } as const
const INVALID_REQUEST = { error: 'invalid_request' } as const
const NOT_FOUND = { error: 'not_found' } as const

// How often an otherwise-idle connection emits a comment line, to keep proxies and load balancers
// from reaping a quiet stream. A comment (`:`-prefixed) is ignored by the EventSource parser, so it
// costs the client nothing.
const HEARTBEAT_MS = 25_000

// Map a data-access task row to its wire shape: pass every field the board renders through, and
// stringify the nullable timestamps to ISO (the repository hands back Date objects). description
// is passed verbatim — it is shown in the language it was authored in and never translated.
export function toTask(row: TaskRow): Task {
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
    projectId: row.projectId,
    // Each assignee carries when they were put on the task (#136), stringified to ISO like every
    // other timestamp; the badge compares it against the viewer's last-seen marker.
    assignees: row.assignees.map((assignee) => ({
      id: assignee.id,
      displayName: assignee.displayName,
      assignedAt: assignee.assignedAt.toISOString(),
    })),
    // The creator's rendered name (#258), hydrated by the repository — the client shows "Created
    // by …" with no user lookup, the same denormalization the assignees ride.
    createdBy: row.creator,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function registerTaskBoardRoutes(app: FastifyInstance, deps: TaskBoardRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  // Resolve the bearer to a fresh principal (ADR-0007), the same shared pre-handler every other
  // protected route uses.
  const requireAuth = createRequireAuth(deps.sessionService)

  // The tier-one coarse role guard (ADR-0007), shared from auth/require-auth.js: the board writes
  // admit only manager and admin, so an employee is refused every write at the route — their sole
  // write is the status-only path in Slice C. What a manager/admin may then touch (their own
  // location vs the chain) is the tier-two scope the write service applies on top.
  const requireManagerOrAdmin = createRequireRole('admin', 'manager')

  // The scoped board read (#131, Slice A). There is no tier-one role guard: the board is the home
  // surface every authenticated role opens, and *what* they see is decided entirely by the scope
  // predicate in the data-access layer from the fresh principal — an employee gets only their own
  // assigned tasks, a manager their whole location including the backlog, an admin the chain —
  // never from a role at the route or any query parameter. Opening the board also bumps this
  // user's last-seen marker (trigger only; the badge is #136) and reports its prior value on the
  // response, so the bump is observable through a follow-up read rather than a row peek. `?peek=1`
  // (#136) is the same read with the bump withheld: the shell's badge poll uses it so a background
  // fetch never counts as the user seeing the board.
  typed.get(
    '/tasks',
    {
      preHandler: requireAuth,
      schema: {
        querystring: taskBoardQuerySchema,
        response: { 200: taskBoardResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      // requireAuth guarantees principal is set before this handler runs.
      const principal = request.principal as Principal
      const board = await deps.boardService.getBoard(principal, {
        peek: request.query.peek === '1',
      })
      return reply.code(200).send({
        tasks: board.tasks.map(toTask),
        lastSeenAt: board.lastSeenAt ? board.lastSeenAt.toISOString() : null,
      })
    },
  )

  // The user actually looked at the board (#136): advance their last-seen marker to now and report
  // where it landed. POST for a state change (repo convention); no tier-one guard — every role has
  // a board and a badge. The SPA calls it when the Tasks screen mounts and again when it unmounts,
  // and patches its cached board's lastSeenAt from the response so the badge clears in place.
  typed.post(
    '/tasks/seen',
    {
      preHandler: requireAuth,
      schema: { response: { 200: taskBoardSeenResponseSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const lastSeenAt = await deps.boardService.markSeen(principal)
      return reply.code(200).send({ lastSeenAt: lastSeenAt.toISOString() })
    },
  )

  // Create a task (#133, Slice B, stories 24-30). Tier-one guard admits only manager and admin; the
  // service then resolves the target location from the principal (a manager's own, an admin's named
  // one) and enforces the assignee-location invariant before the write (ADR-0007) — never trusting
  // the body's location or assignees blindly. On success the created task (as the creator sees it,
  // assignees hydrated) comes back and the change is announced on the live channel.
  typed.post(
    '/tasks',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        body: createTaskRequestSchema,
        response: {
          201: taskSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const body = request.body
      const result = await deps.writeService.createTask(principal, {
        title: body.title,
        // An omitted or blank note is stored as null (never a translated placeholder); the schema
        // has already trimmed and rejected a whitespace-only string.
        description: body.description ?? null,
        priority: body.priority,
        // The wire carries an ISO string; the store works in Date objects.
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        assigneeIds: body.assigneeIds,
        locationId: body.locationId ?? null,
        projectId: body.projectId ?? null,
      })
      if (!result.ok) {
        return reply
          .code(result.reason === 'forbidden' ? 403 : 400)
          .send(result.reason === 'forbidden' ? FORBIDDEN : INVALID_REQUEST)
      }
      return reply.code(201).send(toTask(result.task))
    },
  )

  // Edit a task through the full-update path (#133, Slice B, stories 31-32). Manager/admin only; the
  // service scopes the write to the principal's own location (a task outside it is a non-enumerating
  // 404) and re-checks the assignee-location invariant against the task's own location before the
  // write. Reassignment is just a new assignee set — an empty set moves the task to the backlog.
  // Status is not settable here (Slice C). The updated task rides back and the change is announced.
  typed.post(
    '/tasks/:id/update',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: taskIdParamsSchema,
        body: updateTaskRequestSchema,
        response: {
          200: taskSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const body = request.body
      const result = await deps.writeService.updateTask(principal, request.params.id, {
        title: body.title,
        description: body.description,
        priority: body.priority,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        assigneeIds: body.assigneeIds,
        // Optional (#134, story 43): present, a manager/admin moves status through the full edit;
        // omitted, the status is left untouched (a Slice-B-shaped edit).
        status: body.status,
        // Same rule for the project filing: omitted leaves it alone, explicit null unfiles it.
        projectId: body.projectId,
      })
      if (!result.ok) {
        return reply
          .code(result.reason === 'not_found' ? 404 : 400)
          .send(result.reason === 'not_found' ? NOT_FOUND : INVALID_REQUEST)
      }
      return reply.code(200).send(toTask(result.task))
    },
  )

  // Change a task's status (#134, Slice C, stories 37-45) — the employee's sole write and their
  // dedicated path. Unlike every other board write this carries NO tier-one role guard: an
  // authenticated user reaches it, so an employee acts here (and only here). Authorisation is the
  // tier-two scope predicate the service applies — an employee may move only a task assigned to them,
  // a manager only their location's, an admin any — so a task outside the caller's scope is the same
  // non-enumerating 404 the by-id edits give. The write touches only the status column; completed_at
  // is maintained by the DB trigger, and the change is announced on the live channel. Managers and
  // admins may also set status through the full-update path above, so this path is not gated to them.
  typed.post(
    '/tasks/:id/status',
    {
      preHandler: requireAuth,
      schema: {
        params: taskIdParamsSchema,
        body: updateTaskStatusRequestSchema,
        response: {
          200: taskSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.writeService.updateTaskStatus(
        principal,
        request.params.id,
        request.body.status,
      )
      if (!result.ok) {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send(toTask(result.task))
    },
  )

  // Delete a task (#133, Slice B, story 33). Manager/admin only; the service scopes the delete to
  // the principal's location, so a task outside their scope is the same non-enumerating 404 as edit
  // and removes nothing. The assignee rows cascade away with the task. Success is a bare ack — the
  // acting client drops the card; a deletion is not relayed over the upsert-only live channel, so
  // other viewers see it leave on their next board read (ADR-0015).
  typed.post(
    '/tasks/:id/delete',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        params: taskIdParamsSchema,
        response: {
          200: taskDeleteResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const outcome = await deps.writeService.deleteTask(principal, request.params.id)
      if (outcome === 'not_found') {
        return reply.code(404).send(NOT_FOUND)
      }
      return reply.code(200).send({ status: 'ok' })
    },
  )

  // Reorder a location's board (#135, Slice D, stories 46-52). Tier-one guard admits only manager and
  // admin — an employee never drags, so a reorder from one is refused right here (story 49) — and the
  // service resolves the target board from the principal (a manager's own, an admin's named one) and
  // enforces the tasks-in-location invariant before rewriting `position` (ADR-0007), so a manager
  // cannot arrange another location and no order can name a foreign task. `position` is the single
  // shared per-location order this write sets; the reordered tasks ride back for the acting client,
  // and every placed task is announced on the live channel so the arrangement updates on everyone at
  // once. A `forbidden` (a manager past their location) is 403; an `invalid` (an admin naming no
  // location, or an order naming a task outside it) is 400 — the same shapes as create.
  typed.post(
    '/tasks/reorder',
    {
      preHandler: [requireAuth, requireManagerOrAdmin],
      schema: {
        body: reorderTasksRequestSchema,
        response: {
          200: reorderTasksResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const body = request.body
      const result = await deps.writeService.reorderTasks(principal, {
        orderedIds: body.orderedIds,
        // Null/omitted resolves to the manager's own board; an admin must have named one.
        locationId: body.locationId ?? null,
      })
      if (!result.ok) {
        return reply
          .code(result.reason === 'forbidden' ? 403 : 400)
          .send(result.reason === 'forbidden' ? FORBIDDEN : INVALID_REQUEST)
      }
      return reply.code(200).send({ tasks: result.tasks.map(toTask) })
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
