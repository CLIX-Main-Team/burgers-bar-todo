import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Place a person in a department, or unplace them (2026-09-20, the departments work). An
// admin-tier act scoped exactly as deactivate is: a super_admin reaches anyone, a branch admin
// their own branch and never a peer admin, a manager nobody. The change is in force on the
// person's very next request with no session ceremony, the same way a branch move is. Every
// assertion is at the HTTP seam, mirroring the assign suite this endpoint sits beside.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'
const GOOD_PASSWORD = 'valid-password-123'
const UNKNOWN_DEPARTMENT = '99999999-9999-9999-9999-999999999999'

describe('auth: place a person in a department (2026-09-20)', () => {
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
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
    await harness.seedLocation({ id: LOC_B, name: 'Location B' })
  })

  const signInToken = async (email: string, password: string): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const ownerToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

  // A pending invite, straight from the invite path: the row an admin might correct before the
  // person ever signs in.
  const invite = async (
    token: string,
    body: { email: string; displayName: string; role: string; locationId: string | null },
  ): Promise<string> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })
    expect(invited.statusCode).toBe(201)
    return invited.json<UserSummary>().id
  }

  // An active user through the real invite -> accept path, so the placed row is one production
  // could hold.
  const provision = async (
    token: string,
    body: { email: string; displayName: string; role: string; locationId: string | null },
  ): Promise<string> => {
    const id = await invite(token, body)
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: {
        token: (match as RegExpExecArray)[1],
        password: GOOD_PASSWORD,
        preferredLanguage: 'en',
      },
    })
    expect(accepted.statusCode).toBe(200)
    return id
  }

  const place = (
    token: string | undefined,
    userId: string,
    departmentId: string | null,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'PATCH',
      url: `/users/${userId}`,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: { departmentId },
    })

  it('places a person in the named department, in force on their next request', async () => {
    const owner = await ownerToken()
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })
    const employeeSession = await signInToken('eli@burgers.local', GOOD_PASSWORD)
    const finance = await harness.departmentId('finance')

    const placed = await place(owner, employeeId, finance)
    expect(placed.statusCode).toBe(200)
    expect(placed.json<UserSummary>().departmentId).toBe(finance)

    // The session survives and already speaks from the department: the principal is read fresh
    // from the users row on every request (ADR-0007).
    const me = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${employeeSession}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json<{ departmentId: string | null }>().departmentId).toBe(finance)
  })

  it('unplaces with null, and reaches a pending invite as readily as an active person', async () => {
    const owner = await ownerToken()
    const finance = await harness.departmentId('finance')
    const invitedId = await invite(owner, {
      email: 'noa@burgers.local',
      displayName: 'Noa',
      role: 'employee',
      locationId: LOC_A,
    })

    const placed = await place(owner, invitedId, finance)
    expect(placed.statusCode).toBe(200)
    expect(placed.json<UserSummary>().status).toBe('invited')
    expect(placed.json<UserSummary>().departmentId).toBe(finance)

    const unplaced = await place(owner, invitedId, null)
    expect(unplaced.statusCode).toBe(200)
    expect(unplaced.json<UserSummary>().departmentId).toBeNull()
  })

  it('lets a branch admin place their own branch, never another branch or a peer admin', async () => {
    const owner = await ownerToken()
    await provision(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana',
      role: 'admin',
      locationId: LOC_A,
    })
    const ownBranchEmployee = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })
    const otherBranchEmployee = await provision(owner, {
      email: 'omer@burgers.local',
      displayName: 'Omer',
      role: 'employee',
      locationId: LOC_B,
    })
    const peerAdmin = await provision(owner, {
      email: 'ronen@burgers.local',
      displayName: 'Ronen',
      role: 'admin',
      locationId: LOC_A,
    })
    const admin = await signInToken('dana@burgers.local', GOOD_PASSWORD)
    const operations = await harness.departmentId('operations')

    const own = await place(admin, ownBranchEmployee, operations)
    expect(own.statusCode).toBe(200)
    expect(own.json<UserSummary>().departmentId).toBe(operations)

    // Out of remit is one flat 404 either way, so the id is never confirmed to exist.
    expect((await place(admin, otherBranchEmployee, operations)).statusCode).toBe(404)
    expect((await place(admin, peerAdmin, operations)).statusCode).toBe(404)
  })

  it('refuses a manager outright', async () => {
    const owner = await ownerToken()
    await provision(owner, {
      email: 'yossi@burgers.local',
      displayName: 'Yossi',
      role: 'manager',
      locationId: LOC_A,
    })
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })
    const manager = await signInToken('yossi@burgers.local', GOOD_PASSWORD)

    const refused = await place(manager, employeeId, await harness.departmentId('finance'))
    expect(refused.statusCode).toBe(403)
  })

  it('answers 404 for a department that does not exist, not a 500 off the FK', async () => {
    const owner = await ownerToken()
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })

    const refused = await place(owner, employeeId, UNKNOWN_DEPARTMENT)
    expect(refused.statusCode).toBe(404)
  })

  it('refuses an unauthenticated call', async () => {
    const owner = await ownerToken()
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })

    const refused = await place(undefined, employeeId, await harness.departmentId('finance'))
    expect(refused.statusCode).toBe(401)
  })
})
