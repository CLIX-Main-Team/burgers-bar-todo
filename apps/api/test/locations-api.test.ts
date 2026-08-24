import { randomUUID } from 'node:crypto'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Location management Slice L1 — the admin locations API (#164; ADR-0007). This is the foundation
// both UI consumers (the /locations screen L2, the invite/task pickers L3) will read. Every case
// drives real HTTP and asserts external behaviour only — a status and body, and state read back
// through a follow-up list — never a row at rest. The load-bearing rules the slice must guarantee:
// the whole surface is Admin-only (a manager and an employee are 403 on every verb, the API the
// sole authority — no UI gating is trusted); a duplicate name is accepted (same-name branches are
// legitimate, decision 5); a rename of an unknown id is a 404; and a blank name is refused.
//
// Delete (owner ask 2026-08-16) is held to the rule that keeps decision 4's spirit: a branch is
// removable only while it is empty. With a person or a task still on it the answer is 409 and the
// branch survives, so no click can orphan people or strand work.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface LocationBody {
  id: string
  name: string
}

describe('locations: the admin locations API (#164, Slice L1)', () => {
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

  // --- helpers, driving the HTTP seam ---

  const adminToken = async (): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  // Provision a non-admin (manager or employee) bound to a real Location, through the real
  // invite/accept flow — so the 403 cases prove the route re-authorises the *principal*, not a
  // guessed role. The location the invitee is staffed at is seeded straight in (a manager/employee
  // invite requires one); the locations API itself is what is under test, not how a user gets a
  // location.
  const provisionNonAdmin = async (
    role: 'manager' | 'employee',
    email: string,
  ): Promise<string> => {
    const admin = await adminToken()
    const location = await harness.seedLocation({ name: 'Home Branch' })
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName: email, role, locationId: location.id },
    })
    expect(invited.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const listLocations = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/locations',
      headers: { authorization: `Bearer ${token}` },
    })

  const createLocation = (token: string, body: unknown): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    })

  const renameLocation = (
    token: string,
    id: string,
    body: unknown,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'PATCH',
      url: `/locations/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    })

  const deleteLocation = (token: string, id: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/locations/${id}/delete`,
      headers: { authorization: `Bearer ${token}` },
    })

  // Seed a branch admin through the real /invites seam, the same as provisionNonAdmin above:
  // the invite service now bakes a branch admin bound to a real Location (2026-08-23), so
  // provisioning no longer needs to reach past it into the repository.
  const seedBranchAdmin = async (email: string, locationId: string): Promise<string> => {
    const owner = await adminToken()
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${owner}` },
      payload: { email, displayName: 'Dana Cohen', role: 'admin', locationId },
    })
    expect(invited.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  // --- the admin happy path ---

  it('lets an admin create a Location, list it, then rename it end to end', async () => {
    const admin = await adminToken()

    const created = await createLocation(admin, { name: 'Downtown' })
    expect(created.statusCode).toBe(201)
    const location = created.json<LocationBody>()
    expect(location).toMatchObject({ name: 'Downtown' })
    expect(location.id).toEqual(expect.any(String))

    // The list is the single authoritative source — the created Location surfaces on it.
    const afterCreate = await listLocations(admin)
    expect(afterCreate.statusCode).toBe(200)
    expect(afterCreate.json<{ locations: LocationBody[] }>().locations).toEqual([
      { id: location.id, name: 'Downtown' },
    ])

    // A rename addresses the Location by id and returns the updated row.
    const renamed = await renameLocation(admin, location.id, { name: 'Uptown' })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<LocationBody>()).toEqual({ id: location.id, name: 'Uptown' })

    // The change is observable through a follow-up list — same id, new name, no second row.
    const afterRename = await listLocations(admin)
    expect(afterRename.json<{ locations: LocationBody[] }>().locations).toEqual([
      { id: location.id, name: 'Uptown' },
    ])
  })

  it('lists every Location ordered by name', async () => {
    const admin = await adminToken()
    // Create out of order; the list must come back alphabetical by name.
    for (const name of ['Carmel', 'Aviv', 'Beersheba']) {
      expect((await createLocation(admin, { name })).statusCode).toBe(201)
    }
    const listed = await listLocations(admin)
    expect(listed.statusCode).toBe(200)
    expect(listed.json<{ locations: LocationBody[] }>().locations.map((l) => l.name)).toEqual([
      'Aviv',
      'Beersheba',
      'Carmel',
    ])
  })

  it('accepts a duplicate name — same-name branches are legitimate, no rejection', async () => {
    const admin = await adminToken()

    const first = await createLocation(admin, { name: 'Main Street' })
    const second = await createLocation(admin, { name: 'Main Street' })
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    // Two real, distinct branches that happen to share a name — different ids, both on the list.
    expect(first.json<LocationBody>().id).not.toEqual(second.json<LocationBody>().id)

    const listed = await listLocations(admin)
    expect(
      listed
        .json<{ locations: LocationBody[] }>()
        .locations.filter((l) => l.name === 'Main Street'),
    ).toHaveLength(2)
  })

  // --- delete (owner ask 2026-08-16): only ever an empty branch ---

  it('lets an admin delete an empty branch, and it leaves the list', async () => {
    const admin = await adminToken()
    const created = await createLocation(admin, { name: 'Closing Down' })
    const id = created.json<LocationBody>().id

    const deleted = await deleteLocation(admin, id)
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json()).toEqual({ status: 'ok' })

    // Gone from the authoritative list, and gone for good — a second delete finds nothing.
    expect(
      (await listLocations(admin)).json<{ locations: LocationBody[] }>().locations,
    ).toHaveLength(0)
    expect((await deleteLocation(admin, id)).statusCode).toBe(404)
  })

  it('refuses to delete a branch that still has people on it, and keeps the branch', async () => {
    // The manager provisioned here is staffed at 'Home Branch' through the real invite flow.
    await provisionNonAdmin('manager', 'staffed@burgers.local')
    const admin = await adminToken()
    const home = (await listLocations(admin))
      .json<{ locations: LocationBody[] }>()
      .locations.find((l) => l.name === 'Home Branch') as LocationBody

    const refused = await deleteLocation(admin, home.id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ error: 'location_in_use' })

    // Nothing was removed — the staffed branch is still on the list for its people to belong to.
    expect(
      (await listLocations(admin)).json<{ locations: LocationBody[] }>().locations,
    ).toContainEqual(home)
  })

  it('refuses to delete a branch that still has tasks on it', async () => {
    const admin = await adminToken()
    const created = await createLocation(admin, { name: 'Busy Branch' })
    const id = created.json<LocationBody>().id
    // A task references the branch by FK; deleting under it would strand real work.
    await harness.seedTask({ locationId: id })

    const refused = await deleteLocation(admin, id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toEqual({ error: 'location_in_use' })
    expect(
      (await listLocations(admin)).json<{ locations: LocationBody[] }>().locations,
    ).toHaveLength(1)
  })

  it('answers a delete of an unknown id with 404', async () => {
    const admin = await adminToken()
    expect((await deleteLocation(admin, randomUUID())).statusCode).toBe(404)
  })

  // --- Admin-only enforcement (ADR-0007): a non-admin is 403 on all four verbs ---

  it.each(['manager', 'employee'] as const)(
    'refuses a %s on create, rename, and list',
    async (role) => {
      const nonAdmin = await provisionNonAdmin(role, `${role}@burgers.local`)

      expect((await listLocations(nonAdmin)).statusCode).toBe(403)
      expect((await createLocation(nonAdmin, { name: 'Sneaky Branch' })).statusCode).toBe(403)
      expect((await renameLocation(nonAdmin, randomUUID(), { name: 'Renamed' })).statusCode).toBe(
        403,
      )
      expect((await deleteLocation(nonAdmin, randomUUID())).statusCode).toBe(403)

      // A refused create writes nothing: the admin's own list carries only what it seeded (the
      // non-admin's home branch), never the branch the 403'd create named.
      const admin = await adminToken()
      const names = (await listLocations(admin))
        .json<{ locations: LocationBody[] }>()
        .locations.map((l) => l.name)
      expect(names).not.toContain('Sneaky Branch')
    },
  )

  it('refuses a request with no bearer at all (401)', async () => {
    const anon = await harness.app.inject({ method: 'GET', url: '/locations' })
    expect(anon.statusCode).toBe(401)
  })

  // --- validation and the unknown-id rename ---

  it('answers a rename of an unknown id with 404', async () => {
    const admin = await adminToken()
    const renamed = await renameLocation(admin, randomUUID(), { name: 'Nowhere' })
    expect(renamed.statusCode).toBe(404)
  })

  it('rejects a blank name on create', async () => {
    const admin = await adminToken()
    // Whitespace-only trims to empty and is refused before any row is written.
    const created = await createLocation(admin, { name: '   ' })
    expect(created.statusCode).toBe(400)
    expect(
      (await listLocations(admin)).json<{ locations: LocationBody[] }>().locations,
    ).toHaveLength(0)
  })

  it('rejects a blank name on rename', async () => {
    const admin = await adminToken()
    const created = await createLocation(admin, { name: 'Real Branch' })
    const id = created.json<LocationBody>().id

    const renamed = await renameLocation(admin, id, { name: '   ' })
    expect(renamed.statusCode).toBe(400)
    // The name is untouched — a rejected rename changes nothing.
    expect((await listLocations(admin)).json<{ locations: LocationBody[] }>().locations).toEqual([
      { id, name: 'Real Branch' },
    ])
  })

  // --- branch-admin scoping (2026-08-23): admin narrows to one branch, super_admin keeps the chain ---

  it('shows a branch admin only their own branch', async () => {
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    await harness.seedLocation({ name: 'Haifa' })
    const admin = await seedBranchAdmin('dana@burgers.local', mine.id)

    const list = await listLocations(admin)
    expect(list.statusCode).toBe(200)
    expect(list.json<{ locations: LocationBody[] }>().locations).toEqual([
      expect.objectContaining({ name: 'Dizengoff' }),
    ])
  })

  it('refuses a branch admin creating or deleting a branch', async () => {
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await seedBranchAdmin('dana@burgers.local', mine.id)

    const created = await createLocation(admin, { name: 'Rogue branch' })
    expect(created.statusCode).toBe(403)

    const deleted = await deleteLocation(admin, mine.id)
    expect(deleted.statusCode).toBe(403)
  })

  it('answers 404, not 403, when a branch admin renames another branch', async () => {
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const theirs = await harness.seedLocation({ name: 'Haifa' })
    const admin = await seedBranchAdmin('dana@burgers.local', mine.id)

    const renamed = await renameLocation(admin, theirs.id, { name: 'Not yours' })
    // 403 would confirm the branch exists and let them map the chain by walking ids.
    expect(renamed.statusCode).toBe(404)
  })

  it('lets a branch admin rename their own branch', async () => {
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await seedBranchAdmin('dana@burgers.local', mine.id)

    const renamed = await renameLocation(admin, mine.id, { name: 'Dizengoff Centre' })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ name: 'Dizengoff Centre' })
  })
})
