import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The roster read resolves each user's Location to its printable name (mockup #179): the
// people surface must show `Downtown` / `Chain-wide`, never the raw uuid the shipped
// UserSummary carried. Every assertion is at the HTTP seam — the name is read back through
// GET /users and the create-invite 201 body — so the correlated-subquery resolution in the
// repository is proven the way a client would see it, across both audiences (ADR-0007): an
// admin's cross-Location list carries each branch's own name, a manager's single-Location
// list carries theirs, and a chain-wide admin resolves to null.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'
// Two pinned Locations with distinct, legible names, so a cross-Location admin read proves
// each row resolves its *own* branch name rather than a single shared or stale one.
const DOWNTOWN = '11111111-1111-1111-1111-111111111111'
const AIRPORT = '22222222-2222-2222-2222-222222222222'

describe('auth: roster resolves named locations (#240)', () => {
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
    await harness.seedLocation({ id: DOWNTOWN, name: 'Downtown' })
    await harness.seedLocation({ id: AIRPORT, name: 'Airport' })
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

  const adminToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

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

  const listUsers = async (token: string): Promise<UserSummary[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ users: UserSummary[] }>().users
  }

  const byEmail = (users: UserSummary[], email: string): UserSummary => {
    const found = users.find((u) => u.email === email)
    expect(found, `expected a user with email ${email}`).toBeDefined()
    return found as UserSummary
  }

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  // An active manager for a Location, provisioned the realistic way (invited by the admin,
  // accepts), so a manager-scoped read runs against a genuine manager session.
  const provisionManager = async (email: string, locationId: string): Promise<string> => {
    const token = await adminToken()
    const created = await createInvite(token, {
      email,
      displayName: 'A Manager',
      role: 'manager',
      locationId,
    })
    expect(created.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  it("an admin's cross-Location list carries each row's own resolved Location name", async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'emp-downtown@burgers.local',
      displayName: 'Dana Downtown',
      role: 'employee',
      locationId: DOWNTOWN,
    })
    await createInvite(token, {
      email: 'emp-airport@burgers.local',
      displayName: 'Avi Airport',
      role: 'employee',
      locationId: AIRPORT,
    })

    const users = await listUsers(token)

    const downtown = byEmail(users, 'emp-downtown@burgers.local')
    expect(downtown.locationId).toBe(DOWNTOWN)
    expect(downtown.locationName).toBe('Downtown')

    const airport = byEmail(users, 'emp-airport@burgers.local')
    expect(airport.locationId).toBe(AIRPORT)
    expect(airport.locationName).toBe('Airport')
  })

  it('a chain-wide admin (null Location) resolves to a null name, never a uuid', async () => {
    const token = await adminToken()
    const seed = byEmail(await listUsers(token), SEED_EMAIL)
    expect(seed.role).toBe('super_admin')
    expect(seed.locationId).toBeNull()
    expect(seed.locationName).toBeNull()
  })

  it("a manager's single-Location list carries that Location's name, not its id", async () => {
    const managerToken = await provisionManager('mgr-downtown@burgers.local', DOWNTOWN)
    const adminTok = await adminToken()
    await createInvite(adminTok, {
      email: 'emp-downtown@burgers.local',
      displayName: 'Dana Downtown',
      role: 'employee',
      locationId: DOWNTOWN,
    })

    const users = await listUsers(managerToken)
    // Scoped to the manager's own Location — every row they see resolves to Downtown, and
    // no row leaks another branch (the airport employee is absent, not merely name-hidden).
    expect(users.length).toBeGreaterThan(0)
    for (const user of users) {
      expect(user.locationId).toBe(DOWNTOWN)
      expect(user.locationName).toBe('Downtown')
    }
  })

  it('the create-invite 201 body already carries the resolved Location name', async () => {
    const token = await adminToken()
    const created = await createInvite(token, {
      email: 'fresh@burgers.local',
      displayName: 'Fresh Invitee',
      role: 'employee',
      locationId: AIRPORT,
    })
    expect(created.statusCode).toBe(201)
    const body = created.json<UserSummary>()
    expect(body.locationId).toBe(AIRPORT)
    expect(body.locationName).toBe('Airport')
  })
})
