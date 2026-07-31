import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The first authenticated path through the system (#29): a seeded admin signs in and
// reads who they are. Every assertion is on external behaviour at the HTTP seam —
// status, body, and state seen through a follow-up request — never on a row, a hash,
// or a token at rest (auth plan, testing approach). The seed is the subject of its own
// cases, so calling it in-process is legitimate; it is not an internal helper the
// assertions reach around the API to poke.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'

describe('auth: seed, sign-in, current principal (#29)', () => {
  let harness: TestHarness

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
  })

  const seed = (password = SEED_PASSWORD): Promise<void> =>
    seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password,
    })

  const signIn = (email: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email, password } })

  const me = (authorization?: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authorization ? { authorization } : {},
    })

  // --- Seed admin ---

  it('TC-SEED-01 — seed creates the first admin, who signs in and reads admin/null/active', async () => {
    await seed()

    const login = await signIn(SEED_EMAIL, SEED_PASSWORD)
    expect(login.statusCode).toBe(200)
    const { token } = login.json<{ token: string }>()
    expect(token).toBeTruthy()

    const principal = await me(`Bearer ${token}`)
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({
      role: 'admin',
      locationId: null,
      status: 'active',
    })
    expect(principal.json<{ userId: string }>().userId).toBeTruthy()
  })

  it('TC-SEED-02 — a second seed run leaves the one admin intact and does not overwrite it', async () => {
    await seed()
    // A second run with the same credentials is a no-op and must not break sign-in.
    await seed()
    expect((await signIn(SEED_EMAIL, SEED_PASSWORD)).statusCode).toBe(200)

    // And a run carrying a different password neither overwrites the credential nor
    // creates an alternate admin: the original password still authenticates and the
    // new one never does — the behavioural proof that the upsert did nothing.
    await seed('a-different-password')
    expect((await signIn(SEED_EMAIL, SEED_PASSWORD)).statusCode).toBe(200)
    expect((await signIn(SEED_EMAIL, 'a-different-password')).statusCode).toBe(401)
  })

  it('TC-SEED-03 — the seeded admin can sign in, proving the seed used the real argon2id path', async () => {
    await seed()
    // If the seed had stored anything but a genuine argon2id hash of the password,
    // this verification would fail.
    expect((await signIn(SEED_EMAIL, SEED_PASSWORD)).statusCode).toBe(200)
  })

  // --- Sign-in ---

  it('TC-LOGIN-01 — correct credentials return a session that authenticates a principal read', async () => {
    await seed()
    const { token } = (await signIn(SEED_EMAIL, SEED_PASSWORD)).json<{ token: string }>()
    expect((await me(`Bearer ${token}`)).statusCode).toBe(200)
  })

  it('TC-LOGIN-02 — wrong password returns the single generic failure and no session', async () => {
    await seed()
    const response = await signIn(SEED_EMAIL, 'wrong-password')
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'invalid_credentials' })
    expect(response.json()).not.toHaveProperty('token')
  })

  it('TC-LOGIN-03 — unknown email is indistinguishable from a wrong password', async () => {
    await seed()
    const wrongPassword = await signIn(SEED_EMAIL, 'wrong-password')
    const unknownEmail = await signIn('nobody@burgers.local', 'wrong-password')

    // Same status and same body: nothing tells an attacker whether the email exists.
    expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode)
    expect(unknownEmail.json()).toEqual(wrongPassword.json())
  })

  it('TC-LOGIN-06 — email matches case-insensitively', async () => {
    await seed()
    const response = await signIn(SEED_EMAIL.toUpperCase(), SEED_PASSWORD)
    expect(response.statusCode).toBe(200)
    expect(response.json<{ token: string }>().token).toBeTruthy()
  })

  // --- Session lifecycle ---

  it('TC-SESS-01 — a valid bearer resolves to the correct principal', async () => {
    await seed()
    const { token } = (await signIn(SEED_EMAIL, SEED_PASSWORD)).json<{ token: string }>()

    const principal = await me(`Bearer ${token}`)
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({ role: 'admin', status: 'active' })
  })

  it('TC-SESS-02 — a request with no Authorization header is refused', async () => {
    const response = await me()
    expect(response.statusCode).toBe(401)
  })

  it('TC-SESS-03 — a malformed/garbage bearer is refused', async () => {
    expect((await me('Bearer not-a-real-token')).statusCode).toBe(401)
    expect((await me('garbage-without-scheme')).statusCode).toBe(401)
    expect((await me('Bearer ')).statusCode).toBe(401)
  })
})
