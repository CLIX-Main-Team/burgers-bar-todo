import { type TaskStatus, isChainAdmin } from '@burgers/shared'
import type { Principal } from '../auth/principal.js'
import type {
  CreateProjectInput,
  ProjectRepository,
  ProjectRow,
  UpdateProjectInput,
} from './repository.js'

export type ProjectWriteResult =
  | { ok: true; project: ProjectRow }
  | { ok: false; reason: 'forbidden' | 'invalid' | 'not_found' }

export interface ProjectService {
  list(principal: Principal): Promise<ProjectRow[]>
  get(principal: Principal, id: string): Promise<ProjectRow | null>
  create(principal: Principal, input: CreateProjectCommand): Promise<ProjectWriteResult>
  update(principal: Principal, id: string, input: UpdateProjectInput): Promise<ProjectWriteResult>
  remove(principal: Principal, id: string): Promise<{ ok: boolean }>
}

export interface CreateProjectCommand extends Omit<CreateProjectInput, 'createdBy'> {}

// A project's status, derived from its tasks and never stored (see db/schema.ts). The empty case
// is the one worth stating: a project with no tasks yet is NOT_STARTED, not done. Reading "0 of 0"
// as complete is the classic vacuous-truth bug, and on this screen it would tell a manager a
// branch opening with nothing planned yet had already happened.
export function deriveStatus(doneCount: number, taskCount: number): TaskStatus {
  if (taskCount === 0) return 'not_started'
  if (doneCount >= taskCount) return 'done'
  if (doneCount === 0) return 'not_started'
  return 'in_progress'
}

// Which branch a new project belongs to. Deliberately looser than a task's (task-write-service.ts
// `resolveWriteLocation`) in exactly one way: NULL is a legitimate answer here, meaning "across the
// chain", and a manager may choose it. A menu rollout genuinely has no branch, and forcing every
// manager-created project onto their own branch would make the chain-wide case admin-only for no
// reason. What a manager still may not do is file a project onto SOMEBODY ELSE's branch.
function resolveProjectLocation(
  principal: Principal,
  bodyLocationId: string | null,
): { locationId: string | null } | { reason: 'forbidden' } {
  if (isChainAdmin(principal.role)) return { locationId: bodyLocationId }
  if (principal.role === 'manager') {
    if (bodyLocationId != null && bodyLocationId !== principal.locationId) {
      return { reason: 'forbidden' }
    }
    return { locationId: bodyLocationId }
  }
  return { reason: 'forbidden' }
}

export function createProjectService(repository: ProjectRepository): ProjectService {
  return {
    list: (principal) => repository.list(principal),
    get: (principal, id) => repository.findById(principal, id),

    async create(principal, input) {
      const location = resolveProjectLocation(principal, input.locationId)
      if ('reason' in location) return { ok: false, reason: location.reason }
      const project = await repository.create(principal, {
        ...input,
        locationId: location.locationId,
        // The creator is the acting principal, always — never a client-supplied value.
        createdBy: principal.userId,
      })
      return { ok: true, project }
    },

    // Every by-id write re-reads through the scope predicate first, so a project outside the
    // principal's scope is one non-enumerating not_found rather than a confirmation it exists.
    async update(principal, id, input) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }
      const project = await repository.update(principal, id, input)
      if (!project) return { ok: false, reason: 'not_found' }
      return { ok: true, project }
    },

    async remove(principal, id) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false }
      return { ok: await repository.remove(id) }
    },
  }
}
