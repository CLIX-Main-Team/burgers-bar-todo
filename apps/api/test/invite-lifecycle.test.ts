import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Invite lifecycle: resend, revoke, and token expiry/single-use (#32). Builds on the
// create/accept slice (#31) and reuses the same shared token primitive. Every assertion
// is at the HTTP seam — a pending user seen (or no longer seen) through GET /users, a
// captured mail's one-time link driven back through accept — never by reading rows or a
// token at rest (auth plan, testing approach). The injected clock crosses the invite's
// ~1-week expiry deterministically; the fake mailer captures the resent link.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
// Two pinned Location ids the beforeEach seeds as real `locations` rows, so users.location_id's
// FK is satisfied (#130). Fixed ids keep the own-vs-other-Location cases legible.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'
const GOOD_PASSWORD = 'valid-password-123'
// The harness wires the invite TTL to 168h (~1 week); crossing it proves expiry.
const INVITE_TTL_MS = 168 * 60 * 60 * 1000

describe('auth: invite resend, revoke, and expiry (#32)', () => {
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
    // Seed the two Locations these cases invite into, so the FK on users.location_id resolves.
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
    await harness.seedLocation({ id: LOC_B, name: 'Location B' })
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

  interface InviteBody {
    email: string
    displayName: string
    role: string
    locationId?: string | null
  }

  const createInvite = (token: string, body: InviteBody): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const resend = (token: string, userId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/invites/${userId}/resend`,
      headers: { authorization: `Bearer ${token}` },
    })

  const revoke = (token: string, userId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/invites/${userId}/revoke`,
      headers: { authorization: `Bearer ${token}` },
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

  const findUser = async (token: string, email: string): Promise<UserSummary | undefined> =>
    (await listUsers(token)).find((u) => u.email === email)

  const accept = (
    token: string,
    password: string,
    language = 'he',
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token, password, preferredLanguage: language },
    })

  // The raw one-time token out of the most recently captured invite mail — the same link
  // the recipient would open. base64url, so a run of url-safe characters after `token=`.
  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  // Provision an active manager for a Location the realistic way — an admin invites them,
  // they accept — so manager-authored cases run against a genuine manager session.
  const provisionManager = async (email: string, locationId: string): Promise<string> => {
    const token = await adminToken()
    const created = await createInvite(token, {
      email,
      displayName: 'A Manager',
      role: 'manager',
      locationId,
    })
    expect(created.statusCode).toBe(201)
    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD, 'en')
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  // Create an invite for a pending employee and return the raw link token plus the
  // pending user's id, the two handles the lifecycle cases act on.
  const createPending = async (
    token: string,
    email: string,
    locationId: string = LOC_A,
  ): Promise<{ rawToken: string; userId: string }> => {
    const created = await createInvite(token, {
      email,
      displayName: 'Pending User',
      role: 'employee',
      locationId,
    })
    expect(created.statusCode).toBe(201)
    return { rawToken: latestInviteToken(), userId: created.json<UserSummary>().id }
  }

  // --- Token expiry and single-use ---

  it('TC-ACC-04 — an expired invite token is rejected at accept and does not activate the user', async () => {
    const token = await adminToken()
    const { rawToken } = await createPending(token, 'expiry@burgers.local')

    // Cross the ~1-week expiry: the link is now stale.
    harness.clock.advance(INVITE_TTL_MS + 1000)

    const res = await accept(rawToken, GOOD_PASSWORD)
    expect(res.statusCode).toBe(400)
    expect(res.json()).not.toHaveProperty('token')

    // The user was never activated: still invited, and sign-in fails (no password set).
    expect((await findUser(token, 'expiry@burgers.local'))?.status).toBe('invited')
    expect((await signIn('expiry@burgers.local', GOOD_PASSWORD)).statusCode).toBe(401)
  })

  it('TC-ACC-05 — a used invite token is rejected on a second accept', async () => {
    const token = await adminToken()
    const { rawToken } = await createPending(token, 'used@burgers.local')

    // First accept consumes the token and signs the recipient in.
    expect((await accept(rawToken, GOOD_PASSWORD)).statusCode).toBe(200)

    // The same link a second time is refused — single-use — with the generic 400.
    const second = await accept(rawToken, GOOD_PASSWORD)
    expect(second.statusCode).toBe(400)
    expect(second.json()).not.toHaveProperty('token')
  })

  // --- Resend ---

  it('TC-ACC-07 — after resend, the newly mailed link accepts and the previously mailed link is rejected', async () => {
    const token = await adminToken()
    const { rawToken: oldToken, userId } = await createPending(token, 'resend@burgers.local')

    const res = await resend(token, userId)
    expect(res.statusCode).toBe(200)

    // Resend mails a fresh, distinct link.
    const newToken = latestInviteToken()
    expect(newToken).not.toBe(oldToken)

    // The previously mailed link stops working — proven before consuming the new one, so
    // this is the old token being invalidated, not the user having already accepted.
    const oldRejected = await accept(oldToken, GOOD_PASSWORD)
    expect(oldRejected.statusCode).toBe(400)

    // The newly mailed link accepts and signs the recipient in.
    const accepted = await accept(newToken, GOOD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json<{ token: string }>().token).toBeTruthy()
  })

  // Hiring is one act, on one switch (owner call 2026-08-26, folding the paperwork back into
  // people.invite): whoever may send an invite may chase the one they sent. The remit is still
  // the principal's — a manager reaches their own branch's invites and no other's.
  it('a manager resends the invite they sent themselves, and the old link dies', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)
    const { userId, rawToken } = await createPending(managerToken, 'emp-a@burgers.local', LOC_A)

    expect((await resend(managerToken, userId)).statusCode).toBe(200)
    // The link they replaced stops working, which is what resending means.
    expect((await accept(rawToken, GOOD_PASSWORD)).statusCode).toBe(400)
  })

  it('resending an unknown invite id is refused as not-found', async () => {
    const token = await adminToken()
    const res = await resend(token, '99999999-9999-9999-9999-999999999999')
    expect(res.statusCode).toBe(404)
  })

  // --- Revoke ---

  it('TC-ACC-08 — after revoke, the invite link is rejected and the pending user is gone', async () => {
    const token = await adminToken()
    const { rawToken, userId } = await createPending(token, 'revoke@burgers.local')

    const res = await revoke(token, userId)
    expect(res.statusCode).toBe(200)

    // The pending user is no longer present via the API.
    expect(await findUser(token, 'revoke@burgers.local')).toBeUndefined()

    // The invite link is rejected — the token died with the user.
    const rejected = await accept(rawToken, GOOD_PASSWORD)
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json()).not.toHaveProperty('token')
  })

  it('a manager revokes the invite they sent, and the pending user is gone', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)
    const { userId } = await createPending(managerToken, 'emp-a@burgers.local', LOC_A)

    expect((await revoke(managerToken, userId)).statusCode).toBe(200)
    expect(await findUser(managerToken, 'emp-a@burgers.local')).toBeUndefined()
  })

  it('revoke does not touch an already-active user; refused as not-found', async () => {
    const token = await adminToken()
    const { rawToken, userId } = await createPending(token, 'active@burgers.local')
    // Accept, so the user is active rather than pending.
    expect((await accept(rawToken, GOOD_PASSWORD)).statusCode).toBe(200)

    // Revoke targets pending invites only: an active user is not removed.
    expect((await revoke(token, userId)).statusCode).toBe(404)
    expect(await findUser(token, 'active@burgers.local')).toMatchObject({ status: 'active' })
  })

  it('revoking an unknown invite id is refused as not-found', async () => {
    const token = await adminToken()
    const res = await revoke(token, '99999999-9999-9999-9999-999999999999')
    expect(res.statusCode).toBe(404)
  })
})
