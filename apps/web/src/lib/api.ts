import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  ConsumePasswordResetRequest,
  CreateInviteRequest,
  PrincipalResponse,
  RequestPasswordResetRequest,
  SignInRequest,
  SignInResponse,
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
  method?: 'GET' | 'POST'
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
