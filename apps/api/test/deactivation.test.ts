import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Deactivate, reactivate, and principal freshness (#33): an admin cuts a user's access
// immediately while keeping their record, and can restore it later. Every assertion is
// at the HTTP seam — a refused sign-in, a session refused on its next request, a user
// still observable through GET /users with status deactivated — never by reading rows
// directly (auth plan, testing approach). The injected clock and fake mailer are the
// only substitutions; deactivation itself has no mail or time dependency.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
// An arbitrary Location id — there is no locations table yet (ADR-0010), so location_id
// is an unconstrained uuid column and any uuid stands in for a Location here.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const GOOD_PASSWORD = 'valid-password-123'

describe('auth: deactivate, reactivate, and principal freshness (#33)', () => {
  let harness: TestHarness

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
  })

  // --- helpers, all driving the HTTP seam ---

  const signIn = (email: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email, password } })

  const signInToken = async (email: string, password: string): Promise<string> => {
    const login = await signIn(email, password)
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const adminToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

  const me = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

  const createInvite = (
    token: string,
    body: { email: string; displayName: string; role: string; locationId?: string | null },
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const accept = (
    token: string,
    password: string,
    language = 'en',
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token, password, preferredLanguage: language },
    })

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  const listUsers = async (token: string): Promise<UserSummary[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ users: UserSummary[] }>().users
  }

  const findUser = async (token: string, email: string): Promise<UserSummary | undefined> =>
    (await listUsers(token)).find((u) => u.email === email)

  const deactivate = (token: string | undefined, userId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/users/${userId}/deactivate`,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    })

  const reactivate = (token: string | undefined, userId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/users/${userId}/reactivate`,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    })

  // Provision an active employee the realistic way — an admin invites them, they accept —
  // so the deactivation cases run against a genuine active user holding a real session.
  // Returns the employee's id (from the admin's list) and their live session token.
  const provisionEmployee = async (email: string): Promise<{ id: string; session: string }> => {
    const admin = await adminToken()
    const created = await createInvite(admin, {
      email,
      displayName: 'An Employee',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)
    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD, 'en')
    expect(accepted.statusCode).toBe(200)
    const session = accepted.json<{ token: string }>().token
    const user = await findUser(admin, email)
    expect(user).toBeDefined()
    return { id: (user as UserSummary).id, session }
  }

  // --- Deactivation ---

  it('TC-DEACT-01 — after an admin deactivates a user, that user is refused sign-in', async () => {
    const { id } = await provisionEmployee('emp1@burgers.local')

    // Sign-in works before deactivation.
    expect((await signIn('emp1@burgers.local', GOOD_PASSWORD)).statusCode).toBe(200)

    const res = await deactivate(await adminToken(), id)
    expect(res.statusCode).toBe(200)
    expect(res.json<UserSummary>()).toMatchObject({ id, status: 'deactivated' })

    // And now the same credentials are refused with the generic failure — no hint that
    // the account merely changed state rather than the password being wrong.
    const blocked = await signIn('emp1@burgers.local', GOOD_PASSWORD)
    expect(blocked.statusCode).toBe(401)
    expect(blocked.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('TC-DEACT-02 — a previously valid session is refused on its next request once deactivated', async () => {
    const { id, session } = await provisionEmployee('emp2@burgers.local')

    // The session authenticates before deactivation (principal read succeeds).
    expect((await me(session)).statusCode).toBe(200)

    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)

    // The in-flight session is refused on its very next request — no re-login needed for
    // the cut to land (the principal is read fresh every request, ADR-0007, and the
    // session rows were revoked outright).
    expect((await me(session)).statusCode).toBe(401)
  })

  it('TC-DEACT-03 — after deactivation the user is still observable with status deactivated', async () => {
    const { id } = await provisionEmployee('emp3@burgers.local')

    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)

    // The record is retained, not deleted, so historical creator/assignee references
    // still resolve — the user is still in the admin's list, now marked deactivated.
    const user = await findUser(await adminToken(), 'emp3@burgers.local')
    expect(user).toMatchObject({ id, status: 'deactivated' })
  })

  it('TC-DEACT-04 — after reactivation the user can sign in again with their existing password', async () => {
    const { id } = await provisionEmployee('emp4@burgers.local')

    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)
    expect((await signIn('emp4@burgers.local', GOOD_PASSWORD)).statusCode).toBe(401)

    const res = await reactivate(await adminToken(), id)
    expect(res.statusCode).toBe(200)
    expect(res.json<UserSummary>()).toMatchObject({ id, status: 'active' })

    // No re-provisioning: the original password authenticates again straight away.
    expect((await signIn('emp4@burgers.local', GOOD_PASSWORD)).statusCode).toBe(200)
  })

  // TC-FRESH-01/02 — role/Location reassignment freshness is covered-by-design by the
  // fresh-principal middleware, not by a dedicated endpoint (there is no reassignment
  // endpoint in this feature; #25's operation contract has none). The property this test
  // proves is the same one freshness rests on: a users-row status change taken through
  // the HTTP surface lands on the principal's very next request with no re-login. A
  // future user-management feature that adds a role/Location reassignment endpoint tests
  // TC-FRESH-01/02 against it directly; the middleware it would rely on is exercised here.
  it('TC-FRESH — a status change through the API lands on the very next request (fresh principal)', async () => {
    const { id, session } = await provisionEmployee('fresh@burgers.local')

    const before = await me(session)
    expect(before.statusCode).toBe(200)
    expect(before.json()).toMatchObject({ status: 'active' })

    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)

    // Same session, next request: the change is already reflected — nothing cached went
    // stale. (Here the fresh status also refuses the request; the freshness itself is the
    // point being demonstrated.)
    expect((await me(session)).statusCode).toBe(401)
  })

  // --- Authorization on the status endpoints ---

  it('TC-LOGIN-05 — a deactivated user is refused sign-in with the generic failure', async () => {
    // TC-LOGIN-05 is the sign-in view of deactivation: the auth service admits only
    // active users, so a deactivated account gives the identical generic failure.
    const { id } = await provisionEmployee('login5@burgers.local')
    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)

    const res = await signIn('login5@burgers.local', GOOD_PASSWORD)
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_credentials' })
  })

  it('deactivate and reactivate are admin-only — a manager is forbidden', async () => {
    // Provision a manager the realistic way, and a separate employee to target.
    const admin = await adminToken()
    const mgrCreated = await createInvite(admin, {
      email: 'mgr@burgers.local',
      displayName: 'A Manager',
      role: 'manager',
      locationId: LOC_A,
    })
    expect(mgrCreated.statusCode).toBe(201)
    const mgrAccepted = await accept(latestInviteToken(), GOOD_PASSWORD, 'en')
    const managerToken = mgrAccepted.json<{ token: string }>().token

    const { id } = await provisionEmployee('target@burgers.local')

    expect((await deactivate(managerToken, id)).statusCode).toBe(403)
    expect((await reactivate(managerToken, id)).statusCode).toBe(403)

    // The target is untouched — still active, still able to sign in.
    expect(await findUser(admin, 'target@burgers.local')).toMatchObject({ status: 'active' })
  })

  it('the status endpoints require authentication', async () => {
    const { id } = await provisionEmployee('noauth@burgers.local')
    expect((await deactivate(undefined, id)).statusCode).toBe(401)
    expect((await reactivate(undefined, id)).statusCode).toBe(401)
  })

  it('deactivating an unknown or non-active user is a clean not-found, not a 500', async () => {
    const admin = await adminToken()
    const unknownId = '99999999-9999-9999-9999-999999999999'

    // No such user.
    expect((await deactivate(admin, unknownId)).statusCode).toBe(404)

    // Reactivating a user who is not deactivated (still active) is a no-op not-found —
    // reactivate only ever restores a previously-active, deactivated account.
    const { id } = await provisionEmployee('active@burgers.local')
    expect((await reactivate(admin, id)).statusCode).toBe(404)

    // And re-deactivating an already-deactivated user is likewise not-found (only an
    // active user can be deactivated), so the state stays clean.
    expect((await deactivate(admin, id)).statusCode).toBe(200)
    expect((await deactivate(admin, id)).statusCode).toBe(404)
  })
})
