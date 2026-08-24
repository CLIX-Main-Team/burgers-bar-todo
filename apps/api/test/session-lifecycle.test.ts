import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The rest of the session lifecycle (#30): revocation on demand (logout, logout-all)
// and the sliding idle window that keeps floor staff signed in across shifts. Every
// assertion is at the HTTP seam — a token proven valid or refused through /auth/me, a
// revocation proven by the next request being refused — never by reading a session row
// (auth plan, testing approach). The injected clock drives every expiry case.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const DAY_MS = 24 * 60 * 60 * 1000
// Matches SESSION_TTL_DAYS wired into the harness (ADR-0006, value in ADR-0010).
const TTL_DAYS = 14

describe('auth: logout, logout-all, and session lifecycle (#30)', () => {
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

  // A fresh session token for the seeded admin — sign-in is the only way to mint one,
  // so each call stands in for a distinct device.
  const signInToken = async (): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const me = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

  const logout = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })

  const logoutAll = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/logout-all',
      headers: { authorization: `Bearer ${token}` },
    })

  it('TC-SESS-04 — after logout, the previously valid token is refused on its next use', async () => {
    const token = await signInToken()
    expect((await me(token)).statusCode).toBe(200)

    const out = await logout(token)
    expect(out.statusCode).toBe(200)

    // Revocation is a row delete and is immediate: the next request is refused.
    expect((await me(token)).statusCode).toBe(401)
  })

  it('TC-SESS-05 — the idle window slides on use, staying valid past the original instant', async () => {
    const token = await signInToken()

    // Used inside the window: this slides expiry forward from now to now + TTL.
    harness.clock.advance(10 * DAY_MS)
    expect((await me(token)).statusCode).toBe(200)

    // Past the original issue-plus-window instant (day 14), but the day-10 use pushed
    // expiry out to day 24, so the token still authenticates.
    harness.clock.advance(5 * DAY_MS)
    expect((await me(token)).statusCode).toBe(200)
  })

  it('TC-SESS-06 — a session left idle past the full window expires', async () => {
    const token = await signInToken()

    // No use for the whole window plus a minute: the next request is refused.
    harness.clock.advance(TTL_DAYS * DAY_MS + 60_000)
    expect((await me(token)).statusCode).toBe(401)
  })

  it('TC-SESS-07 — a token issued earlier still authenticates on a later request (restart)', async () => {
    const token = await signInToken()

    // Time passes within the window with no re-sign-in, standing in for closing and
    // reopening the app; the same token still resolves to the principal.
    harness.clock.advance(5 * DAY_MS)
    const principal = await me(token)
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({ role: 'super_admin', status: 'active' })
  })

  it('TC-SESS-08 — logout revokes only the current session, not the other device', async () => {
    const deviceA = await signInToken()
    const deviceB = await signInToken()

    expect((await logout(deviceA)).statusCode).toBe(200)

    // A is cut; B, a distinct session, is untouched.
    expect((await me(deviceA)).statusCode).toBe(401)
    expect((await me(deviceB)).statusCode).toBe(200)
  })

  it('TC-SESS-09 — logout-all revokes every session at once', async () => {
    const deviceA = await signInToken()
    const deviceB = await signInToken()

    expect((await logoutAll(deviceA)).statusCode).toBe(200)

    // Both tokens' next requests are refused — the lost-or-stolen-device case.
    expect((await me(deviceA)).statusCode).toBe(401)
    expect((await me(deviceB)).statusCode).toBe(401)
  })
})
