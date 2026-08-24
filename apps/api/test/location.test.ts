import { randomUUID } from 'node:crypto'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The task-board prefactor (#130): Location is now a real table and users.location_id is a real
// FK -> locations. These cases prove the graduation end to end through real paths — a seeded
// Location is bound to a user by the invite/accept flow and surfaces on the principal, an admin
// stays chain-wide with a null location, and the FK actually bites on a phantom Location id.
// Every positive assertion is at the HTTP seam, as the rest of the auth suite is.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

describe('locations: the task-board prefactor (#130)', () => {
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

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  const accept = (token: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token, password, preferredLanguage: 'en' },
    })

  const me = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

  it('binds an employee to a seeded Location through invite/accept, and the principal reads it back', async () => {
    const location = await harness.seedLocation({ name: 'Downtown' })
    const admin = await adminToken()

    const invited = await createInvite(admin, {
      email: 'emp@burgers.local',
      displayName: 'Emp One',
      role: 'employee',
      locationId: location.id,
    })
    expect(invited.statusCode).toBe(201)

    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    const employeeToken = accepted.json<{ token: string }>().token

    // The principal is read fresh from the users row (ADR-0007), so its location_id is the FK
    // value that survived a real INSERT — proof the row bound to the seeded Location.
    const principal = await me(employeeToken)
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({
      role: 'employee',
      locationId: location.id,
      status: 'active',
    })
  })

  it('keeps the seeded admin chain-wide with a null location', async () => {
    const principal = await me(await adminToken())
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({ role: 'super_admin', locationId: null })
  })

  it('rejects a user bound to a Location id that does not exist — the FK is real', async () => {
    // The real create path (createInvitedUser) with a phantom Location id must be refused by the
    // FK, not silently written. A bare uuid column (the pre-#130 state) would have accepted it.
    await expect(
      harness.components.repo.createInvitedUser({
        email: 'orphan@burgers.local',
        displayName: 'No Such Location',
        role: 'employee',
        locationId: randomUUID(),
        now: harness.clock.now(),
      }),
    ).rejects.toThrow()
  })
})
