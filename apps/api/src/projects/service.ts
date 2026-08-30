import { type TaskStatus, holdsBranch } from '@burgers/shared'
import type { Principal } from '../auth/principal.js'
import type {
  ChecklistItemRow,
  CreateProjectInput,
  ProjectCandidateRow,
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

// An assignee write has one failure the others do not: a name that is not on this project's
// candidate list. It is `invalid`, not `not_found` — the project and the item both exist, and the
// client that sent it is out of date rather than probing for rows.
export type AssignWriteResult =
  | { ok: true; view: ProjectView }
  | { ok: false; reason: 'not_found' | 'invalid' }

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
  listCandidates(principal: Principal, id: string): Promise<ProjectCandidateRow[] | null>
  setChecklistItemAssignees(
    principal: Principal,
    id: string,
    itemId: string,
    userIds: string[],
  ): Promise<AssignWriteResult>
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

// Whether this principal authors the project in front of them, as opposed to merely working
// inside it. It is `resolveProjectLocations` asked about a project that already exists, and it
// gates the acts that change what the project IS — renaming it, deleting it, adding or striking
// checklist lines. Ticking a line is not one of those: that is doing the work, and everyone the
// scope predicate admits may do it.
function maySteer(principal: Principal, locationIds: string[]): boolean {
  return !('reason' in resolveProjectLocations(principal, locationIds, locationIds))
}

// Which branches a project may name (owner call 2026-08-25). A project that spans branches, or
// names none and so runs chain-wide, is the owner's alone: nobody below them starts work at a
// branch they do not run, or rewrites the terms of work that reaches one. Everyone else authors
// projects at their own branch and exactly there.
//
// `existing` is what makes an EDIT checkable, and it is why a wider project cannot be captured one
// save at a time: a branch admin named in a three-branch rollout can see it and tick its checklist,
// but its pre-image names branches that are not theirs, so the edit is refused outright rather than
// applied with the other two quietly dropped. Omitted on a create, where there is no pre-image.
//
// Duplicates are collapsed rather than refused: a client that sends the same branch twice meant it
// once, and a project holding a branch twice would count it twice everywhere it is displayed.
function resolveProjectLocations(
  principal: Principal,
  bodyLocationIds: string[],
  existing?: string[],
): { locationIds: string[] } | { reason: 'forbidden' } {
  const locationIds = [...new Set(bodyLocationIds)]
  // Every branch-less principal gets the owner's lane (2026-08-27): an HQ role with
  // projects.manage plans chain-wide or at any branch, exactly because no branch is theirs.
  // The route's capability guard is what keeps the roles without projects.manage out.
  if (!holdsBranch(principal.role)) return { locationIds }
  // Any branch-holding role, not a role list (2026-08-24): the tier-one guard is a capability the
  // owner may widen, and a widened role gets the branch lane here rather than a silent refusal.
  if (principal.locationId) {
    const isOwnBranchAlone = (ids: string[]) => ids.length === 1 && ids[0] === principal.locationId
    if (existing && !isOwnBranchAlone(existing)) return { reason: 'forbidden' }
    if (!isOwnBranchAlone(locationIds)) return { reason: 'forbidden' }
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
      await repository.addChecklistItems(project.id, checklist)
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
      // An edit can narrow a project's reach — drop a role, swap chain-wide for one branch — and
      // the people who fall out must not keep standing on its steps. Somebody named on a step of a
      // project they can no longer open reads as work that is somebody's when it is nobody's, and
      // they cannot see it to say so.
      await repository.pruneAssigneesOutOfScope(project)
      return { ok: true, project }
    },

    async remove(principal, id) {
      const existing = await repository.findById(principal, id)
      if (!existing || !maySteer(principal, existing.locationIds)) return { ok: false }
      return { ok: await repository.remove(id) }
    },

    async addChecklistItem(principal, id, title) {
      const existing = await repository.findById(principal, id)
      if (!existing || !maySteer(principal, existing.locationIds)) {
        return { ok: false, reason: 'not_found' }
      }
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
      if (!existing || !maySteer(principal, existing.locationIds)) {
        return { ok: false, reason: 'not_found' }
      }
      const removed = await repository.removeChecklistItem(id, itemId)
      if (!removed) return { ok: false, reason: 'not_found' }
      // Deleting the last unticked item can complete a project — the same crossing, reached from
      // the other direction.
      return viewAfterChecklistChange(principal, id)
    },

    async listCandidates(principal, id) {
      // Through the scope predicate first, so a project this principal cannot see does not hand
      // back its branch's staff list.
      const project = await repository.findById(principal, id)
      if (!project) return null
      return repository.listCandidates(principal, project)
    },

    async setChecklistItemAssignees(principal, id, itemId, userIds) {
      const existing = await repository.findById(principal, id)
      if (!existing) return { ok: false, reason: 'not_found' }

      // Re-derived here, never trusted from the request. The picker offering only valid choices
      // is a courtesy to the person using it; this is the rule (ADR-0007). It also closes the gap
      // between a picker rendered five minutes ago and a project whose branches changed since.
      const wanted = [...new Set(userIds)]
      if (wanted.length > 0) {
        const candidates = await repository.listCandidates(principal, existing)
        const allowed = new Set(candidates.map((candidate) => candidate.id))
        if (wanted.some((userId) => !allowed.has(userId))) {
          return { ok: false, reason: 'invalid' }
        }
      }

      const written = await repository.setChecklistItemAssignees(id, itemId, wanted)
      if (!written) return { ok: false, reason: 'not_found' }
      // Naming somebody moves no phase, but this path returns the same whole-project shape as
      // every other checklist write: one response shape for the screen, and the client is never
      // left holding two different ideas of what a checklist write returns.
      return viewAfterChecklistChange(principal, id)
    },
  }
}
