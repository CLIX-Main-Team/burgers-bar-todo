import type { TaskSubject } from '@burgers/shared'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Principal } from '../auth/principal.js'
import type { Db } from '../db/client.js'
import { taskAssignees, taskSubjects, tasks, users } from '../db/schema.js'
import { departmentPredicate, taskScopePredicate } from '../task-board/scope.js'

// How many faces a subject card shows before it says "+N". Four fits the card's width beside the
// progress line on a phone; the overflow count tells the rest.
const CARD_FACES = 4

// The data-access seam for task subjects (owner ask 2026-09-20), the cards a department's shared
// work is filed under. Every read carries the same department horizon the task board applies
// (task-board/scope.ts), so a subject outside the viewer's department resolves nothing: an `own`
// viewer asking for another department's list gets an empty one, and a by-id read of a foreign
// subject reads as absent rather than confirming it exists. The counts and faces on a card are
// over the tasks the VIEWER can see through the task predicate, so a card never claims work the
// board behind it would then not show.
export interface TaskSubjectRepository {
  // One department's cards, or every department's the horizon reaches when none is named.
  listSubjectsInScope(principal: Principal, departmentId?: string): Promise<TaskSubject[]>
  // The bare row when the viewer's department horizon admits it, else null.
  findSubjectInScope(principal: Principal, subjectId: string): Promise<SubjectRow | null>
  // Create answers the new row, or null when the department already holds a subject that reads
  // the same (the lower(name) unique index). The caller has already checked the department is in
  // the writer's horizon.
  createSubject(input: CreateSubjectInput): Promise<SubjectRow | null>
  // Rename/redescribe within the writer's horizon: the updated row, null when nothing matched
  // (unknown id or foreign department), or `duplicate` when the new name collides.
  updateSubjectInScope(
    principal: Principal,
    subjectId: string,
    input: UpdateSubjectInput,
  ): Promise<SubjectRow | null | 'duplicate'>
  // Delete within the writer's horizon. Refused while any task still points at the subject, with
  // the count so the dialog can say so: the tasks are the reason the row exists.
  deleteSubjectInScope(principal: Principal, subjectId: string): Promise<DeleteSubjectOutcome>
}

export type SubjectRow = typeof taskSubjects.$inferSelect

export interface CreateSubjectInput {
  departmentId: string
  name: string
  description: string | null
  createdBy: string
  now: Date
}

export interface UpdateSubjectInput {
  name: string
  description: string | null
  now: Date
}

export type DeleteSubjectOutcome =
  | { outcome: 'ok' }
  | { outcome: 'not_found' }
  | { outcome: 'in_use'; taskCount: number }

// Postgres's code for a unique-index collision, the one failure create and rename turn into an
// answer rather than a crash.
const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION
  )
}

export function createTaskSubjectRepository(db: Db): TaskSubjectRepository {
  // The subjects this principal may see, filtered in the WHERE (ADR-0007 tier two).
  const scoped = (principal: Principal, subjectId: string) =>
    and(eq(taskSubjects.id, subjectId), departmentPredicate(principal))

  return {
    listSubjectsInScope: async (principal, departmentId) => {
      // Counts as correlated subqueries over the task predicate: the same rows the board would
      // show this viewer, split by done-ness. One round trip for the rows and their numbers.
      const visible = and(eq(tasks.subjectId, taskSubjects.id), taskScopePredicate(principal))
      const rows = await db
        .select({
          id: taskSubjects.id,
          departmentId: taskSubjects.departmentId,
          name: taskSubjects.name,
          description: taskSubjects.description,
          position: taskSubjects.position,
          openCount: sql<number>`(select count(*)::int from ${tasks} where ${visible} and ${tasks.status} <> 'done')`,
          doneCount: sql<number>`(select count(*)::int from ${tasks} where ${visible} and ${tasks.status} = 'done')`,
        })
        .from(taskSubjects)
        .where(
          and(
            departmentId === undefined ? sql`true` : eq(taskSubjects.departmentId, departmentId),
            departmentPredicate(principal),
          ),
        )
        .orderBy(asc(taskSubjects.position), asc(taskSubjects.name), asc(taskSubjects.id))
      if (rows.length === 0) return []

      // The faces: everyone holding an OPEN task in each subject, name-ordered so the stack is
      // stable, one query for the whole list. Done work drops off the card the way it drops off
      // the open count; the people who finished it are the board's story, not the card's.
      const faceRows = await db
        .selectDistinct({
          subjectId: tasks.subjectId,
          id: users.id,
          displayName: users.displayName,
          avatarTone: users.avatarTone,
        })
        .from(taskAssignees)
        .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(
          and(
            inArray(
              tasks.subjectId,
              rows.map((row) => row.id),
            ),
            ne(tasks.status, 'done'),
            taskScopePredicate(principal),
          ),
        )
        .orderBy(asc(users.displayName), asc(users.id))

      const facesBySubject = new Map<string, TaskSubject['assignees']>()
      for (const face of faceRows) {
        if (!face.subjectId) continue
        const list = facesBySubject.get(face.subjectId)
        const person = { id: face.id, displayName: face.displayName, avatarTone: face.avatarTone }
        if (list) list.push(person)
        else facesBySubject.set(face.subjectId, [person])
      }

      return rows.map((row) => {
        const faces = facesBySubject.get(row.id) ?? []
        return {
          ...row,
          assignees: faces.slice(0, CARD_FACES),
          assigneeOverflow: Math.max(0, faces.length - CARD_FACES),
        }
      })
    },

    findSubjectInScope: async (principal, subjectId) => {
      const rows = await db.select().from(taskSubjects).where(scoped(principal, subjectId)).limit(1)
      return rows[0] ?? null
    },

    createSubject: async ({ departmentId, name, description, createdBy, now }) => {
      // New subjects go last: the position is one past the department's current tail, so the
      // grid keeps creation order until somebody arranges it.
      try {
        const rows = await db
          .insert(taskSubjects)
          .values({
            departmentId,
            name,
            description,
            createdBy,
            position: sql`(select coalesce(max(${taskSubjects.position}), -1) + 1 from ${taskSubjects} where ${taskSubjects.departmentId} = ${departmentId})`,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        return rows[0] ?? null
      } catch (error) {
        if (isUniqueViolation(error)) return null
        throw error
      }
    },

    updateSubjectInScope: async (principal, subjectId, { name, description, now }) => {
      try {
        const rows = await db
          .update(taskSubjects)
          .set({ name, description, updatedAt: now })
          .where(scoped(principal, subjectId))
          .returning()
        return rows[0] ?? null
      } catch (error) {
        if (isUniqueViolation(error)) return 'duplicate'
        throw error
      }
    },

    deleteSubjectInScope: async (principal, subjectId) => {
      // The horizon first, so a foreign id is one non-enumerating miss and never learns whether
      // the subject holds work. Then the count over ALL tasks in the subject rather than the
      // viewer's slice: somebody else's branch's work makes it just as much in use, and the FK
      // would refuse the delete anyway.
      const [subject] = await db
        .select({ id: taskSubjects.id })
        .from(taskSubjects)
        .where(scoped(principal, subjectId))
        .limit(1)
      if (!subject) return { outcome: 'not_found' }
      const [held] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.subjectId, subjectId))
      if (held && held.count > 0) return { outcome: 'in_use', taskCount: held.count }
      const deleted = await db
        .delete(taskSubjects)
        .where(scoped(principal, subjectId))
        .returning({ id: taskSubjects.id })
      return deleted.length > 0 ? { outcome: 'ok' } : { outcome: 'not_found' }
    },
  }
}
