import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Move a person to another branch (owner ask 2026-08-27, the branch staffing slots). A chain
// act: only a super_admin may call it, the role travels unchanged, and the move is in force on
// the person's very next request without any session ceremony. Every assertion is at the HTTP
// seam, mirroring the deactivation suite this endpoint sits beside.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'
const GOOD_PASSWORD = 'valid-password-123'

describe('auth: assign a person to another branch (2026-08-27)', () => {
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

  // Provision an active user through the real invite -> accept path, so the moved row is one
  // production could hold.
  const provision = async (
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
    return invited.json<UserSummary>().id
  }

  const assign = (
    token: string | undefined,
    userId: string,
    locationId: string,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/users/${userId}/assign`,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      payload: { locationId },
    })

  it('moves a person to the named branch, role unchanged, in force on their next request', async () => {
    const owner = await ownerToken()
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })
    const employeeSession = await signInToken('eli@burgers.local', GOOD_PASSWORD)

    const moved = await assign(owner, employeeId, LOC_B)
    expect(moved.statusCode).toBe(200)
    const summary = moved.json<UserSummary>()
    expect(summary.role).toBe('employee')
    expect(summary.locationId).toBe(LOC_B)
    expect(summary.locationName).toBe('Location B')

    // The session survives the move and already speaks from the new branch: the principal is
    // read fresh from the users row on every request (ADR-0007).
    const me = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${employeeSession}` },
    })
    expect(me.statusCode).toBe(200)
    expect(me.json<{ locationId: string }>().locationId).toBe(LOC_B)
  })

  it('refuses everyone below super_admin, own-branch admin included', async () => {
    const owner = await ownerToken()
    await provision(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana',
      role: 'admin',
      locationId: LOC_A,
    })
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })
    const admin = await signInToken('dana@burgers.local', GOOD_PASSWORD)

    const refused = await assign(admin, employeeId, LOC_B)
    expect(refused.statusCode).toBe(403)
  })

  it('answers 404 for a super_admin target, who is branch-less by rule', async () => {
    const owner = await ownerToken()
    const peerId = await provision(owner, {
      email: 'peer@burgers.local',
      displayName: 'Peer',
      role: 'super_admin',
      locationId: null,
    })

    const refused = await assign(owner, peerId, LOC_A)
    expect(refused.statusCode).toBe(404)
  })

  it('answers 404 for a branch that does not exist, not a 500 off the FK', async () => {
    const owner = await ownerToken()
    const employeeId = await provision(owner, {
      email: 'eli@burgers.local',
      displayName: 'Eli',
      role: 'employee',
      locationId: LOC_A,
    })

    const refused = await assign(owner, employeeId, '99999999-9999-9999-9999-999999999999')
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

    const refused = await assign(undefined, employeeId, LOC_B)
    expect(refused.statusCode).toBe(401)
  })
})
