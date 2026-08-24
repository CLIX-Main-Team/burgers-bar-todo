import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  AccessMatrixResponse,
  ChecklistMutationResponse,
  ConsumePasswordResetRequest,
  CreateInviteRequest,
  CreateLocationRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  CreateThreadRequest,
  DeviceAcknowledgement,
  KnowledgeDocListResponse,
  Location,
  LocationDeleteResponse,
  LocationListResponse,
  PostThreadMessageRequest,
  PrincipalResponse,
  ProjectDeleteResponse,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectSummary,
  RegisterDeviceRequest,
  ReorderTasksResponse,
  RequestPasswordResetRequest,
  SignInRequest,
  SignInResponse,
  Task,
  TaskBoardResponse,
  TaskBoardSeenResponse,
  TaskDeleteResponse,
  TaskStatus,
  ThreadDeleteResponse,
  ThreadDetail,
  ThreadListResponse,
  UnregisterDeviceRequest,
  UpdateAccessRequest,
  UpdateLocationRequest,
  UpdateProjectRequest,
  UpdateTaskRequest,
  UserListResponse,
  UserSummary,
} from '@burgers/shared'
import { getStoredToken } from './token-storage.js'

// The one API base URL the SPA reads (ADR-0010): apps/web only ever sees
// VITE_API_BASE_URL, so no server secret can be VITE-exposed into the bundle.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// Every non-2xx from the API is surfaced as this one error type carrying the HTTP
// status and the generic error code from the shared error envelope ({ error }). The
// screens branch on `code` only where the flow legitimately differs (a bad token vs a
// generic failure); the deliberately non-enumerating flows (sign-in, reset-request)
// never branch their wording on it.
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string) {
    super(`api error ${status}: ${code}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

// Classify a caught error for the pre-auth screens, which all share the same two-way
// split: a transport failure (the request may never have reached the server) versus any
// server-side outcome (which, for the non-enumerating flows, is shown as one generic
// message that never branches on the reason). Centralising it keeps every screen's
// onError identical instead of re-testing `status === 0` by hand.
export function classifyAuthError(error: unknown): 'network' | 'generic' {
  return error instanceof ApiError && error.status === 0 ? 'network' : 'generic'
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  // Pre-auth calls (sign-in, accept, reset) carry no bearer; everything else sends the
  // stored session token. Default is to attach it when one exists.
  auth?: boolean
}

// The single fetch seam. It prepends the API base, sets JSON headers, attaches the
// bearer as `Authorization: Bearer <token>` on every authenticated call (ADR-0006,
// ui-flow: the bearer is sent on every API call), and normalises failures into
// ApiError. It never reads or writes the token store beyond reading the current value.
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth) {
    const token = getStoredToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // A transport failure (API down, CORS, offline) is a distinct code so screens can
    // show a "could not reach the server" message rather than a credential message.
    throw new ApiError(0, 'network_error')
  }

  const text = await response.text()
  const payload: unknown = text ? JSON.parse(text) : undefined

  if (!response.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : 'unknown'
    throw new ApiError(response.status, code)
  }

  return payload as T
}

// The typed auth surface. One function per endpoint in routes/auth.ts, named for the
// operation and shaped by the shared contract, so callers never build a path or a body
// by hand.
export const authApi = {
  signIn(body: SignInRequest): Promise<SignInResponse> {
    return request('/auth/sign-in', { method: 'POST', body, auth: false })
  },
  acceptInvite(body: AcceptInviteRequest): Promise<AcceptInviteResponse> {
    return request('/auth/accept', { method: 'POST', body, auth: false })
  },
  requestReset(body: RequestPasswordResetRequest): Promise<{ status: 'ok' }> {
    return request('/auth/reset-request', { method: 'POST', body, auth: false })
  },
  consumeReset(body: ConsumePasswordResetRequest): Promise<{ status: 'ok' }> {
    return request('/auth/reset-consume', { method: 'POST', body, auth: false })
  },
  me(): Promise<PrincipalResponse> {
    return request('/auth/me')
  },
  logout(): Promise<{ status: 'ok' }> {
    return request('/auth/logout', { method: 'POST' })
  },
  logoutAll(): Promise<{ status: 'ok' }> {
    return request('/auth/logout-all', { method: 'POST' })
  },
  listUsers(): Promise<UserListResponse> {
    return request('/users')
  },
  createInvite(body: CreateInviteRequest): Promise<UserSummary> {
    return request('/invites', { method: 'POST', body })
  },
  resendInvite(id: string): Promise<{ status: 'ok' }> {
    return request(`/invites/${id}/resend`, { method: 'POST' })
  },
  revokeInvite(id: string): Promise<{ status: 'ok' }> {
    return request(`/invites/${id}/revoke`, { method: 'POST' })
  },
  deactivateUser(id: string): Promise<UserSummary> {
    return request(`/users/${id}/deactivate`, { method: 'POST' })
  },
  reactivateUser(id: string): Promise<UserSummary> {
    return request(`/users/${id}/reactivate`, { method: 'POST' })
  },
}

// The push-device surface (#59). Only the native wrapper shells call these — the browser SPA has
// no push — and only ever for the signed-in user, whose identity rides the bearer rather than the
// body, so a device can never be claimed for someone else's account.
export const devicesApi = {
  register(body: RegisterDeviceRequest): Promise<DeviceAcknowledgement> {
    return request('/devices', { method: 'POST', body })
  },
  unregister(body: UnregisterDeviceRequest): Promise<DeviceAcknowledgement> {
    return request('/devices/unregister', { method: 'POST', body })
  },
}

// The typed task-board surface (#131, Slice A). The scoped board read is filtered to the caller's
// principal by the API (ADR-0007); the SPA never asks for a scope. The read always peeks (#136):
// the shell's Tasks-tab badge polls this same query from every screen, and a background poll must
// never count as the user seeing the board — so the last-seen marker moves only through markSeen,
// which the Tasks screen calls on mount and unmount (the user's actual visit).
export const tasksApi = {
  board(): Promise<TaskBoardResponse> {
    return request('/tasks?peek=1')
  },
  markSeen(): Promise<TaskBoardSeenResponse> {
    return request('/tasks/seen', { method: 'POST' })
  },
  // The manager/admin writes (#133, Slice B). All three are POST — the repo's convention for a
  // state change — and the API alone authorises them (a tier-one role guard plus the tier-two scope
  // predicate and the assignee-location invariant, ADR-0007); the UI only ever mirrors what the
  // principal may do so a user is never offered a guaranteed-rejection action. Create and edit
  // return the task as the caller now sees it; delete carries a bare acknowledgement.
  createTask(body: CreateTaskRequest): Promise<Task> {
    return request('/tasks', { method: 'POST', body })
  },
  updateTask(id: string, body: UpdateTaskRequest): Promise<Task> {
    return request(`/tasks/${id}/update`, { method: 'POST', body })
  },
  // The status-only write (#134, Slice C) — an employee's sole write, and the manager/admin's quick
  // move too. The API authorises it by scope (an employee only on a task assigned to them), touches
  // only the status column, and maintains completed_at by trigger; it returns the task as the caller
  // now sees it. Sent as { status } to a dedicated path, kept apart from the full-update body so the
  // employee surface can never carry another field.
  updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return request(`/tasks/${id}/status`, { method: 'POST', body: { status } })
  },
  deleteTask(id: string): Promise<TaskDeleteResponse> {
    return request(`/tasks/${id}/delete`, { method: 'POST' })
  },
  // The manual drag-reorder write (#135, Slice D). A manager or admin sends one location's task ids
  // in a new order; the API rewrites each task's `position` to its index, so `position` is the one
  // canonical shared per-location order every viewer opens to. locationId is omitted for a manager
  // (their own board is resolved server-side) and named by an admin (who holds none of their own);
  // the API re-authorises by scope regardless (ADR-0007), and announces the reordered tasks on the
  // live channel so every viewer's board converges. Returns the reordered board in the new order.
  reorderTasks(orderedIds: string[], locationId?: string | null): Promise<ReorderTasksResponse> {
    return request('/tasks/reorder', {
      method: 'POST',
      body: { orderedIds, locationId: locationId ?? null },
    })
  },
  // The URL of the live board channel (#132, Slice A2, ADR-0015). The board subscribes to this with
  // a native EventSource, which cannot set an Authorization header and reconnects by reissuing the
  // URL — so the bearer rides as an `access_token` query parameter, validated by the API through
  // the same session path that gates every other call (the principal it yields is identical). It is
  // encoded so a token with URL-significant characters cannot break the query. Returns null when no
  // session is stored, so the caller simply opens no channel rather than a tokenless one.
  streamUrl(): string | null {
    const token = getStoredToken()
    if (!token) return null
    return `${API_BASE_URL}/tasks/stream?access_token=${encodeURIComponent(token)}`
  },
}

// The typed locations surface (#164, Slice L1). Consumed by the L2 admin screen (create / update /
// list) and, via the shared useLocations hook, by the L3 pickers (the invite Location picker and the
// task-form board list, which retires the "distinct locationIds from the people list" hack). Every
// call is Admin-only and re-authorised server-side (ADR-0007); the UI gates the surface to admins as a
// convenience, never as the authority. `create` carries no client-side uniqueness — same-name
// branches are legitimate (decision 5), so the screen's soft "already exists" confirm is driven off
// the list read, not this call. `update` is the repo's one PATCH, addressing the Location by id and
// sending only the fields the caller actually touched (2026-08-24, PR 2 task 1) — the branch detail
// page's name edit and its address/city/phone edits are the same call with a different body shape.
// The projects surface. Manager-and-up on both sides: the API guards it (a tier-one role guard
// plus the projects scope predicate, ADR-0007) and the SPA's own route mirrors that, so nobody is
// shown a screen the API would refuse. Writes are POST with the verb in the path, the same
// convention the task writes follow.
export const projectsApi = {
  list(): Promise<ProjectListResponse> {
    return request('/projects')
  },
  // One project plus the tasks filed under it, already scoped to what this principal may see.
  detail(id: string): Promise<ProjectDetailResponse> {
    return request(`/projects/${id}`)
  },
  createProject(body: CreateProjectRequest): Promise<ProjectSummary> {
    return request('/projects', { method: 'POST', body })
  },
  updateProject(id: string, body: UpdateProjectRequest): Promise<ProjectSummary> {
    return request(`/projects/${id}/update`, { method: 'POST', body })
  },
  // The project goes, and its checklist with it. Any board task that referenced it stays on the
  // board, unfiled — losing a grouping never loses real work.
  deleteProject(id: string): Promise<ProjectDeleteResponse> {
    return request(`/projects/${id}/delete`, { method: 'POST' })
  },
  // Every checklist write answers with the WHOLE project plus its checklist, because ticking the
  // last item can move the project's phase to `completed` on its own. Returning the item alone
  // would leave the client to guess whether the phase moved and refetch to find out.
  addChecklistItem(id: string, title: string): Promise<ChecklistMutationResponse> {
    return request(`/projects/${id}/checklist`, { method: 'POST', body: { title } })
  },
  setChecklistItemDone(
    id: string,
    itemId: string,
    done: boolean,
  ): Promise<ChecklistMutationResponse> {
    return request(`/projects/${id}/checklist/${itemId}`, { method: 'POST', body: { done } })
  },
  deleteChecklistItem(id: string, itemId: string): Promise<ChecklistMutationResponse> {
    return request(`/projects/${id}/checklist/${itemId}/delete`, { method: 'POST' })
  },
}

export const locationsApi = {
  list(): Promise<LocationListResponse> {
    return request('/locations')
  },
  create(body: CreateLocationRequest): Promise<Location> {
    return request('/locations', { method: 'POST', body })
  },
  update(id: string, body: UpdateLocationRequest): Promise<Location> {
    return request(`/locations/${id}`, { method: 'PATCH', body })
  },
  // Delete a branch (owner ask 2026-08-16) — POST, the repo's convention for a state change. The
  // API refuses a branch that still has people or tasks on it with a 409 the screen reads by
  // status, so the "move them first" message is driven by the server's own answer, never guessed
  // from the counts the screen happens to hold.
  remove(id: string): Promise<LocationDeleteResponse> {
    return request(`/locations/${id}/delete`, { method: 'POST' })
  },
}

// The Knowledge tab's typed surface (ADR-0024): the one manager/admin read behind the
// auto-organized Knowledge Base browser. Re-authorised server-side like every call here;
// the nav's canProvision gate is a convenience, never the authority (ADR-0007).
export const knowledgeApi = {
  list(): Promise<KnowledgeDocListResponse> {
    return request('/assistant/knowledge')
  },
}

// The Access surface (owner ask 2026-08-24): every signed-in role reads the effective
// role-capability matrix; a super_admin flips one switch at a time. Update answers with the
// whole fresh matrix, so the page repaints from the server's truth.
export const accessApi = {
  matrix(): Promise<AccessMatrixResponse> {
    return request('/access')
  },
  update(body: UpdateAccessRequest): Promise<AccessMatrixResponse> {
    return request('/access/update', { method: 'POST', body })
  },
}

// The typed assistant surface (#93). A conversation is a thread of turns: creating one writes the
// first user turn, and posting to it writes a user turn plus the grounded agent reply (#90, #91,
// ADR-0003). Both are POST — the repo's convention for a state change — and both are author-scoped by
// the API from the principal, never from the body (ADR-0007), so the SPA never names an owner or a
// role. Create returns the new thread with its one user turn; postMessage returns the thread's full,
// updated history, whose final `agent` turn is the answer the surface reveals. A model failure is a
// retryable 503 that persists nothing (an ApiError with status 503), so the surface retries the
// question in place with no orphaned turn (ADR-0003).
//
// A thread is created lazily on the first question and reused for the session; the thread drawer,
// list, and switching (#94) let a user keep several and move between them. `listThreads` and
// `getThread` are the two reads the drawer needs — the caller's own threads (most-recently-active
// first) and one thread's full history — both author-scoped by the API from the principal, never a
// query parameter (ADR-0007). Because create writes a user turn and the answer path writes another,
// the live surface renders from its own local view (echoing each question once, revealing each answer
// once) rather than mirroring the persisted list; a thread reopened through `getThread` collapses the
// resulting doubled opening turn client-side (see turnsFromMessages), the flow the ADR-0003
// direct-answer shape leaves to the client.
export const assistantApi = {
  createThread(body: CreateThreadRequest): Promise<ThreadDetail> {
    return request('/threads', { method: 'POST', body })
  },
  postMessage(threadId: string, body: PostThreadMessageRequest): Promise<ThreadDetail> {
    return request(`/threads/${threadId}/messages`, { method: 'POST', body })
  },
  listThreads(): Promise<ThreadListResponse> {
    return request('/threads')
  },
  getThread(threadId: string): Promise<ThreadDetail> {
    return request(`/threads/${threadId}`)
  },
  // Hard-delete one of the caller's own threads (#257) — POST, the repo's convention for a state
  // change, mirroring the board's deleteTask. The API scopes the delete to the principal, so this
  // can only ever remove the caller's own conversation.
  deleteThread(threadId: string): Promise<ThreadDeleteResponse> {
    return request(`/threads/${threadId}/delete`, { method: 'POST' })
  },
}
