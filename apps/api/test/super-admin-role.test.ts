import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The fourth role, from the v2 design (2026-08-20). super_admin carries exactly admin's
// abilities for now, which is precisely why it needs a test: an equality that is only asserted
// by comments rots the moment someone adds a `role === 'admin'` literal. These cases drive the
// HTTP seam, so they fail if any tier of the guard chain — the route's requireRole, the service's
// resolve step, or the repository's scope predicate — forgets the role.
//
// The one asymmetry worth noticing: the seed account *is* the bootstrap super_admin (2026-08-23).
// It is the only account with no inviter, and a branch-less admin stopped being a legal row when
// admin narrowed to one branch — so there is nothing else the first account could be. Every other
// super_admin is created by an existing one through the ordinary invite flow.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const OWNER_PASSWORD = 'valid-password-123'

describe('super_admin: a second admin-level role', () => {
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

  const signIn = async (email: string, password: string): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  // Invite an owner as the seeded admin, accept it, and hand back the owner's bearer.
  const ownerToken = async (): Promise<string> => {
    const admin = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email: 'owner@burgers.local', displayName: 'Chain Owner', role: 'super_admin' },
    })
    expect(invited.statusCode).toBe(201)

    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: OWNER_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const get = (url: string, token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })

  it('is invitable by an admin and comes back with no location of its own', async () => {
    const principal = await get('/auth/me', await ownerToken())
    expect(principal.statusCode).toBe(200)
    // Location null is the admin-level shape: chain-wide, not bound to a branch.
    expect(principal.json()).toMatchObject({
      role: 'super_admin',
      locationId: null,
      status: 'active',
    })
  })

  it('reaches the admin-only locations surface, which a manager may not', async () => {
    const locations = await get('/locations', await ownerToken())
    expect(locations.statusCode).toBe(200)
  })

  it('sees the whole roster, not one branch', async () => {
    const admin = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: {
        email: 'noa@burgers.local',
        displayName: 'Noa Levi',
        role: 'employee',
        locationId: branch.id,
      },
    })
    expect(invited.statusCode).toBe(201)

    const roster = await get('/users', await ownerToken())
    expect(roster.statusCode).toBe(200)
    const emails = roster.json<{ users: { email: string }[] }>().users.map((u) => u.email)
    // Both the branch employee and the seeded admin, i.e. the unscoped chain-wide view.
    expect(emails).toContain('noa@burgers.local')
    expect(emails).toContain(SEED_EMAIL)
  })

  it('may itself invite, the way an admin can', async () => {
    const branch = await harness.seedLocation({ name: 'Ben Yehuda' })
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${await ownerToken()}` },
      payload: {
        email: 'ori@burgers.local',
        displayName: 'Ori Mizrahi',
        role: 'manager',
        locationId: branch.id,
      },
    })
    expect(invited.statusCode).toBe(201)
  })

  it('sees the chain-wide board, not one branch', async () => {
    const board = await get('/tasks', await ownerToken())
    expect(board.statusCode).toBe(200)
  })

  it('seeds the first user as a chain owner, not a branch admin', async () => {
    const principal = await get('/auth/me', await signIn(SEED_EMAIL, SEED_PASSWORD))
    expect(principal.statusCode).toBe(200)
    // The seed is the only account with no inviter, so it must be the chain-wide role: a
    // branch-less `admin` is no longer a legal row.
    expect(principal.json()).toMatchObject({ role: 'super_admin', locationId: null })
  })
})
