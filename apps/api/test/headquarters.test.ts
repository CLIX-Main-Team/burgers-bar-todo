import type { Location, PrincipalResponse, UserSummary } from '@burgers/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The company headquarters as a location row (owner ask 2026-09-21, ADR-0029, migration 0051).
// "Not literally a branch, but a branch for this system": the row the office roles hold, so that
// from now on the owner is the only branch-less person in the chain.
//
// What this pins down, all through the HTTP seam:
//  - the row exists on a migrated database without anyone creating it, and is the one row of its
//    kind; every branch the app creates is kind `branch`
//  - an office role invited with no branch named sits at the head office; named a branch, it sits
//    there instead (every role can sit at a branch); a branch role still has to say which branch
//  - a branch admin is refused at the head office, on the invite path and on the move path alike
//  - the owner stays branch-less, and the principal says which kind of place everyone else holds
//  - the head office cannot be deleted, whatever is on it
const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface InviteBody {
  email: string
  displayName: string
  role: string
  locationId?: string
}

describe('the head office location', () => {
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

  const listLocations = async (token: string): Promise<Location[]> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/locations',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ locations: Location[] }>().locations
  }

  const headquarters = async (token: string): Promise<Location> => {
    const office = (await listLocations(token)).find((row) => row.kind === 'headquarters')
    expect(office).toBeDefined()
    return office as Location
  }

  const createInvite = async (token: string, body: InviteBody) =>
    harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { departmentId: await harness.departmentId('management'), ...body },
    })

  const latestInviteToken = (): string => {
    const match = /token=([\w-]+)/.exec(harness.mailer.sent.at(-1)?.text ?? '')
    return (match as RegExpExecArray)[1] as string
  }

  const inviteAndAccept = async (ownerToken: string, body: InviteBody): Promise<string> => {
    const created = await createInvite(ownerToken, body)
    expect(created.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const me = async (token: string): Promise<PrincipalResponse> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<PrincipalResponse>()
  }

  it('exists on a migrated database, once, and every branch the app creates is a branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const before = await listLocations(owner)
    expect(before.filter((row) => row.kind === 'headquarters')).toHaveLength(1)
    // Seeded, not clicked in: it carries the chain's own name for it and no branch number.
    expect(before.find((row) => row.kind === 'headquarters')).toMatchObject({
      name: 'מטה החברה',
      number: null,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/locations',
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: 'Dizengoff' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<Location>().kind).toBe('branch')

    const after = await listLocations(owner)
    expect(after.filter((row) => row.kind === 'headquarters')).toHaveLength(1)
    expect(after.filter((row) => row.kind === 'branch').map((row) => row.name)).toEqual([
      'Dizengoff',
    ])
  })

  it('places an office role at the head office when the invite names it, and nowhere when it does not', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)

    // Every role but the owner's holds a location, and the body says which (owner note
    // 2026-09-21): no location is a malformed invite, never a silent placement at the office.
    const bare = await createInvite(owner, {
      email: 'cfo@burgers.local',
      displayName: 'Chain CFO',
      role: 'finance_manager',
    })
    expect(bare.statusCode).toBe(400)

    const invited = await createInvite(owner, {
      email: 'cfo@burgers.local',
      displayName: 'Chain CFO',
      role: 'finance_manager',
      locationId: office.id,
    })
    expect(invited.statusCode).toBe(201)
    expect(invited.json<UserSummary>()).toMatchObject({
      role: 'finance_manager',
      locationId: office.id,
      locationName: office.name,
      locationKind: 'headquarters',
    })
  })

  it('lets an office role sit at a branch when the invite names one', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })

    const invited = await createInvite(owner, {
      email: 'chef@burgers.local',
      displayName: 'Chain Chef',
      role: 'chain_chef',
      locationId: branch.id,
    })
    expect(invited.statusCode).toBe(201)
    expect(invited.json<UserSummary>()).toMatchObject({
      role: 'chain_chef',
      locationId: branch.id,
      locationKind: 'branch',
    })
  })

  it('lets a driver sit at the head office too, and makes every located role name its place', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)

    // Branch tier, but forbidden a branch until today; the office can be home when named.
    const driver = await createInvite(owner, {
      email: 'driver@burgers.local',
      displayName: 'Chain Driver',
      role: 'driver',
      locationId: office.id,
    })
    expect(driver.statusCode).toBe(201)
    expect(driver.json<UserSummary>()).toMatchObject({ role: 'driver', locationId: office.id })

    // "Which one" is a question every located role has to answer, a manager included.
    const manager = await createInvite(owner, {
      email: 'mgr@burgers.local',
      displayName: 'Nameless Manager',
      role: 'manager',
    })
    expect(manager.statusCode).toBe(400)
  })

  it('refuses a branch admin at the head office, invited or moved there', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })

    const invited = await createInvite(owner, {
      email: 'hq-admin@burgers.local',
      displayName: 'Office Admin',
      role: 'admin',
      locationId: office.id,
    })
    expect(invited.statusCode).toBe(400)

    // The same admin, legitimately at a branch, cannot be transferred into the office either.
    const placed = await createInvite(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: branch.id,
    })
    expect(placed.statusCode).toBe(201)
    const dana = placed.json<UserSummary>()
    const moved = await harness.app.inject({
      method: 'POST',
      url: `/users/${dana.id}/assign`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { locationId: office.id },
    })
    expect(moved.statusCode).toBe(404)

    const roster = await harness.app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${owner}` },
    })
    const people = roster.json<{ users: UserSummary[] }>().users
    expect(people.find((person) => person.email === 'hq-admin@burgers.local')).toBeUndefined()
    expect(people.find((person) => person.id === dana.id)).toMatchObject({
      locationId: branch.id,
      locationKind: 'branch',
    })
  })

  // The move path used to admit the branch trio only (0033's rule); now that every role but the
  // owner holds a location, every role but the owner can be moved, office roles included, in both
  // directions. The owner stays where they are: branch-less, and a move of them finds nothing.
  it('moves an office role from the head office to a branch and back', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })

    const placed = await createInvite(owner, {
      email: 'books@burgers.local',
      displayName: 'Chain Bookkeeper',
      role: 'bookkeeper',
      locationId: office.id,
    })
    expect(placed.statusCode).toBe(201)
    const clerk = placed.json<UserSummary>()
    expect(clerk).toMatchObject({ locationId: office.id, locationKind: 'headquarters' })

    const assign = (userId: string, locationId: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/users/${userId}/assign`,
        headers: { authorization: `Bearer ${owner}` },
        payload: { locationId },
      })

    const toBranch = await assign(clerk.id, branch.id)
    expect(toBranch.statusCode).toBe(200)
    expect(toBranch.json<UserSummary>()).toMatchObject({
      locationId: branch.id,
      locationName: 'Dizengoff',
      locationKind: 'branch',
    })

    const backToOffice = await assign(clerk.id, office.id)
    expect(backToOffice.statusCode).toBe(200)
    expect(backToOffice.json<UserSummary>()).toMatchObject({
      locationId: office.id,
      locationName: office.name,
      locationKind: 'headquarters',
    })

    const ownerRow = (await me(owner)).userId
    expect((await assign(ownerRow, branch.id)).statusCode).toBe(404)
    expect(await me(owner)).toMatchObject({ locationId: null, locationKind: null })
  })

  it('tells each principal which kind of place they hold, and leaves the owner branch-less', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })

    expect(await me(owner)).toMatchObject({ locationId: null, locationKind: null })

    const clerk = await inviteAndAccept(owner, {
      email: 'books@burgers.local',
      displayName: 'Chain Bookkeeper',
      role: 'bookkeeper',
      locationId: office.id,
    })
    expect(await me(clerk)).toMatchObject({
      locationId: office.id,
      locationName: office.name,
      locationKind: 'headquarters',
    })

    const manager = await inviteAndAccept(owner, {
      email: 'mia@burgers.local',
      displayName: 'Mia Levi',
      role: 'manager',
      locationId: branch.id,
    })
    expect(await me(manager)).toMatchObject({ locationId: branch.id, locationKind: 'branch' })
  })

  it('cannot be deleted, whatever is on it', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const office = await headquarters(owner)

    const refused = await harness.app.inject({
      method: 'POST',
      url: `/locations/${office.id}/delete`,
      headers: { authorization: `Bearer ${owner}` },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ error: 'location_headquarters' })
    expect((await listLocations(owner)).find((row) => row.id === office.id)).toBeDefined()
  })
})
