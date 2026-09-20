import {
  type TaskSubject,
  createTaskSubjectRequestSchema,
  errorResponseSchema,
  taskDeleteResponseSchema,
  taskSubjectIdParamsSchema,
  taskSubjectInUseResponseSchema,
  taskSubjectListQuerySchema,
  taskSubjectListResponseSchema,
  taskSubjectSchema,
  updateTaskSubjectRequestSchema,
} from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { AccessService } from '../access/service.js'
import type { Clock } from '../auth/clock.js'
import { type Principal, viewScope } from '../auth/principal.js'
import { createRequireAuth, createRequireCapability } from '../auth/require-auth.js'
import type { SessionService } from '../auth/sessions.js'
import type { SubjectRow, TaskSubjectRepository } from '../task-subjects/repository.js'

// The subjects surface (owner ask 2026-09-20): the cards a department's shared work is filed
// under. The list read gates on the Tasks page and narrows by the tasks.departments horizon in
// the repository; the three writes gate on tasks.manageSubjects, a switch the owner holds for
// the super admin by default, and narrow by the same horizon so a writer given the switch still
// only shapes departments they can see.
export interface TaskSubjectRouteDeps {
  sessionService: SessionService
  subjects: TaskSubjectRepository
  accessService: AccessService
  clock: Clock
}

const NOT_FOUND = { error: 'not_found' } as const
// A name the department already has. Told plainly: the writer can see the card it collides with.
const DUPLICATE = { error: 'duplicate_name' } as const

// A row as create and rename answer it: freshly made or renamed, so it holds no work yet or the
// caller is about to re-read the list anyway. Zero counts and no faces keep the wire shape one
// shape, and the cards read is what fills them in.
function toBareSubject(row: SubjectRow): TaskSubject {
  return {
    id: row.id,
    departmentId: row.departmentId,
    name: row.name,
    description: row.description,
    position: row.position,
    openCount: 0,
    doneCount: 0,
    assignees: [],
    assigneeOverflow: 0,
  }
}

export function registerTaskSubjectRoutes(app: FastifyInstance, deps: TaskSubjectRouteDeps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const requireAuth = createRequireAuth(deps.sessionService)
  const requireCapability = createRequireCapability(deps.accessService)
  const requireTasksRead = requireCapability('page.tasks', 'page.dashboard')
  const requireManageSubjects = requireCapability('tasks.manageSubjects')

  // Whether a create may file under this department: the same horizon the reads apply, asked
  // once here because a create names a department rather than a subject the repository could
  // scope by id.
  const mayFileUnder = (principal: Principal, departmentId: string): boolean =>
    viewScope(principal, 'tasks.departments') === 'chain' || principal.departmentId === departmentId

  typed.get(
    '/tasks/subjects',
    {
      preHandler: [requireAuth, requireTasksRead],
      schema: {
        querystring: taskSubjectListQuerySchema,
        response: {
          200: taskSubjectListResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const subjects = await deps.subjects.listSubjectsInScope(
        principal,
        request.query.departmentId,
      )
      return reply.code(200).send({ subjects })
    },
  )

  // One subject by id, for the screen that opens on a subject's URL and knows nothing else about
  // it yet. Bare (no counts): the board read behind it carries the tasks, and counting them there
  // is the viewer's own truth. Out of horizon reads as absent.
  typed.get(
    '/tasks/subjects/:id',
    {
      preHandler: [requireAuth, requireTasksRead],
      schema: {
        params: taskSubjectIdParamsSchema,
        response: {
          200: taskSubjectSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const row = await deps.subjects.findSubjectInScope(principal, request.params.id)
      if (!row) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send(toBareSubject(row))
    },
  )

  typed.post(
    '/tasks/subjects',
    {
      preHandler: [requireAuth, requireManageSubjects],
      schema: {
        body: createTaskSubjectRequestSchema,
        response: {
          201: taskSubjectSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const { departmentId, name, description } = request.body
      // A department outside the writer's horizon is one non-enumerating miss, never a 403 that
      // confirms it exists.
      if (!mayFileUnder(principal, departmentId)) {
        return reply.code(404).send(NOT_FOUND)
      }
      const row = await deps.subjects.createSubject({
        departmentId,
        name,
        description: description ?? null,
        createdBy: principal.userId,
        now: deps.clock.now(),
      })
      if (!row) return reply.code(409).send(DUPLICATE)
      return reply.code(201).send(toBareSubject(row))
    },
  )

  typed.post(
    '/tasks/subjects/:id/update',
    {
      preHandler: [requireAuth, requireManageSubjects],
      schema: {
        params: taskSubjectIdParamsSchema,
        body: updateTaskSubjectRequestSchema,
        response: {
          200: taskSubjectSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const result = await deps.subjects.updateSubjectInScope(principal, request.params.id, {
        name: request.body.name,
        description: request.body.description,
        now: deps.clock.now(),
      })
      if (result === 'duplicate') return reply.code(409).send(DUPLICATE)
      if (!result) return reply.code(404).send(NOT_FOUND)
      return reply.code(200).send(toBareSubject(result))
    },
  )

  typed.post(
    '/tasks/subjects/:id/delete',
    {
      preHandler: [requireAuth, requireManageSubjects],
      schema: {
        params: taskSubjectIdParamsSchema,
        response: {
          200: taskDeleteResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          409: taskSubjectInUseResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const principal = request.principal as Principal
      const outcome = await deps.subjects.deleteSubjectInScope(principal, request.params.id)
      switch (outcome.outcome) {
        case 'ok':
          return reply.code(200).send({ status: 'ok' })
        case 'in_use':
          return reply.code(409).send({ error: 'subject_in_use', taskCount: outcome.taskCount })
        default:
          return reply.code(404).send(NOT_FOUND)
      }
    },
  )
}
