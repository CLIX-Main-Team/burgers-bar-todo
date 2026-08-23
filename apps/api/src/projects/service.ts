import { type TaskStatus, isChainAdmin } from '@burgers/shared'
import type { Principal } from '../auth/principal.js'
import type {
  ChecklistItemRow,
  CreateProjectInput,
  ProjectRepository,
  ProjectRow,
  UpdateProjectInput,
} from './repository.js'

export interface ProjectView {
  project: ProjectRow
  checklist: ChecklistItemRow[]
}

export type ProjectWriteResult =
  | { ok: true; project: ProjectRow }
  | { ok: false; reason: 'forbidden' | 'invalid' | 'not_found' }

export type ChecklistWriteResult =
  | { ok: true; view: ProjectView }
  | { ok: false; reason: 'not_found' }

export interface CreateProjectCommand extends Omit<CreateProjectInput, 'createdBy'> {
  // The checklist typed while the project was being described. Written in the order given.
  checklist: string[]
}

export interface ProjectService {
  list(principal: Principal): Promise<ProjectRow[]>
  get(principal: Principal, id: string): Promise<ProjectView | null>
  create(principal: Principal, input: CreateProjectCommand): Promise<ProjectWriteResult>
  update(principal: Principal, id: string, input: UpdateProjectInput): Promise<ProjectWriteResult>
  remove(principal: Principal, id: string): Promise<{ ok: boolean }>
  addChecklistItem(principal: Principal, id: string, title: string): Promise<ChecklistWriteResult>
  setChecklistItemDone(
    principal: Principal,
    id: string,
    itemId: string,
    done: boolean,
  ): Promise<ChecklistWriteResult>
  removeChecklistItem(
    principal: Principal,
    id: string,
    itemId: string,
  ): Promise<ChecklistWriteResult>
}

// A project's status, derived from its checklist and never stored (see db/schema.ts). The empty
// case is the one worth stating: a project with no checklist yet is NOT_STARTED, not done. Reading
// "0 of 0" as complete is the classic vacuous-truth bug, and on this screen it would tell a manager
// a branch opening with nothing planned yet had already happened.
export function deriveStatus(doneCount: number, taskCount: number): TaskStatus {
  if (taskCount === 0) return 'not_started'
  if (doneCount >= taskCount) return 'done'
  if (doneCount === 0) return 'not_started'
  return 'in_progress'
}

// The phase the checklist implies, or null when it implies nothing.
//
// The rule the owner asked for, and its mirror: ticking the LAST item moves the project to
// `completed` on its own, so nobody has to remember to close one — and un-ticking an item takes
// `completed` back off, because a project cannot honestly claim to be finished while work is open
// inside it. Anything else the phase is set to is left alone; only these two crossings are
// automatic.
export function phaseAfterChecklistChange(
  currentPhase: string,
  doneCount: number,
  taskCount: number,
): string | null {
  const allDone = taskCount > 0 && doneCount >= taskCount
  if (allDone && currentPhase !== 'completed') return 'completed'
  if (!allDone && currentPhase === 'completed') return 'in_progress'
  return null
}

// Which branches a project may name. Deliberately looser than a task's
// (task-write-service.ts `resolveWriteLocation`) in exactly one way: the EMPTY set is a legitimate
// answer here, meaning "across the chain", and a manager may choose it. A menu rollout genuinely
// has no branch, and forcing every manager-created project onto their own branch would make the
// chain-wide case admin-only for no reason. What a manager still may not do is file a project onto
// SOMEBODY ELSE's branch — which, now that the field is a set, means not naming one anywhere in it.
//
// Duplicates are collapsed rather than refused: a client that sends the same branch twice meant it
// once, and a project holding a branch twice would count it twice everywhere it is displayed.
// `existing` is what the project already names, and it is what makes editing one possible for a
// manager whose branch is only part of it: an admin can put a manager's branch into a three-branch
// rollout, and that manager must still be able to rename it without the save being read as an
// attempt to reach the other two. So a manager may KEEP any branch already there, ADD only their
// own, and REMOVE any. On a create `existing` is empty, which leaves exactly their own branch.
function resolveProjectLocations(
  principal: Principal,
  bodyLocationIds: string[],
  existing: string[] = [],
): { locationIds: string[] } | { reason: 'forbidden' } {
  const locationIds = [...new Set(bodyLocationIds)]
  if (isChainAdmin(principal.role)) return { locationIds }
  if (principal.role === 'manager') {
    const allowed = new Set([...existing, principal.locationId].filter((id) => id !== null))
    if (locationIds.some((id) => !allowed.has(id))) return { reason: 'forbidden' }
    return { locationIds }
  }
  return { reason: 'forbidden' }
}

export function createProjectService(repository: ProjectRepository): ProjectService {
  // Re-read the project and its checklist together, applying the automatic phase move if the
  // change just crossed (or left) fully-ticked. Every checklist write funnels through here, so
  // there is exactly one place the rule lives and one shape the client gets back.
  async function viewAfterChecklistChange(
    principal: Principal,
    id: string,
  ): Promise<ChecklistWriteResult> {
    const project = await repository.findById(principal, id)
    if (!project) return { ok: false, reason: 'not_found' }
    const nextPhase = phaseAfterChecklistChange(project.phase, project.doneCount, project.taskCount)
    if (nextPhase) {
      await repository.setPhase(id, nextPhase)
      project.phase = nextPhase
    }
    const checklist = await repository.listChecklist(id)
    return { ok: true, view: { project, checklist } }
  }

  return {
    list: (principal) => repository.list(principal),

    async get(principal, id) {
      const project = await repository.findById(principal, id)
      if (!project) return null
      return { project, checklist: await repository.listChecklist(id) }
    },

    async create(principal, input) {
      const branches = resolveProjectLocations(principal, input.locationIds)
      if ('reason' in branches) return { ok: false, reason: branches.reason }
      const { checklist, ...fields } = input
      const project = await repository.create(principal, {
        ...fields,
        locationIds: branches.locationIds,
        // The creator is the acting principal, always — never a client-supplied value.
        createdBy: principal.userId,
      })
      for (const title of checklist) {
        await repository.addChecklistItem(project.id, title)
      }
      // Re-read so the counts reflect the items just written; a create that reported 0 of 5 would
      // be wrong the instant it rendered.
      const hydrated = await repository.findById(principal, project.id)
      return { ok: true, project: hydrated ?? project }
    },

    // Every by-id write re-reads through the scope predicate first, so a project outside the
    // principal's scope is one non-enumerating not_found rather than a confirmation it exists.
    async update(principal, id, input) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }
      // The same branch check the create does, because an edit can widen a project's reach: a
      // manager who could add a branch here could reach past their own by editing rather than
      // creating, which is the same hole with a longer path to it.
      const branches = resolveProjectLocations(principal, input.locationIds, existing.locationIds)
      if ('reason' in branches) return { ok: false, reason: branches.reason }
      const project = await repository.update(principal, id, {
        ...input,
        locationIds: branches.locationIds,
      })
      if (!project) return { ok: false, reason: 'not_found' }
      return { ok: true, project }
    },

    async remove(principal, id) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false }
      return { ok: await repository.remove(id) }
    },

    async addChecklistItem(principal, id, title) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }
      await repository.addChecklistItem(id, title)
      // Adding an unticked item to a completed project un-completes it, which is the mirror rule
      // doing its job rather than a special case.
      return viewAfterChecklistChange(principal, id)
    },

    async setChecklistItemDone(principal, id, itemId, done) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }
      const item = await repository.setChecklistItemDone(id, itemId, done)
      if (!item) return { ok: false, reason: 'not_found' }
      return viewAfterChecklistChange(principal, id)
    },

    async removeChecklistItem(principal, id, itemId) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }
      const removed = await repository.removeChecklistItem(id, itemId)
      if (!removed) return { ok: false, reason: 'not_found' }
      // Deleting the last unticked item can complete a project — the same crossing, reached from
      // the other direction.
      return viewAfterChecklistChange(principal, id)
    },
  }
}
