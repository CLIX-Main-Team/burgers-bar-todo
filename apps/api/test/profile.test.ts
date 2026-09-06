import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The Profile page's own-row edits (2026-09-04): a person renames themself, picks a disc colour,
// and changes their password while signed in. Every assertion is at the HTTP seam — the fresh
// principal /auth/me answers, and whether a session still opens the door afterwards.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'

describe('profile: own name, colour, password', () => {
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

  const signIn = async (password = SEED_PASSWORD): Promise<string> => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password },
    })
    expect(response.statusCode).toBe(200)
    return `Bearer ${response.json<{ token: string }>().token}`
  }

  const me = (authorization: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'GET', url: '/auth/me', headers: { authorization } })

  const patchMe = (authorization: string, payload: unknown): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'PATCH', url: '/auth/me', headers: { authorization }, payload })

  const changePassword = (
    authorization: string,
    payload: unknown,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization },
      payload,
    })

  it('answers the account fields on /auth/me: email, no colour yet, no branch for the owner', async () => {
    const auth = await signIn()
    const principal = await me(auth)
    expect(principal.json()).toMatchObject({
      email: SEED_EMAIL,
      avatarTone: null,
      locationName: null,
    })
  })

  it('PATCH /auth/me renames and colours the caller, answering the fresh principal', async () => {
    const auth = await signIn()

    const patched = await patchMe(auth, { displayName: '  Dana Cohen ', avatarTone: 5 })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({ displayName: 'Dana Cohen', avatarTone: 5 })

    // The next read carries it: the session's principal is resolved fresh from the row.
    expect((await me(auth)).json()).toMatchObject({ displayName: 'Dana Cohen', avatarTone: 5 })
  })

  it('a partial PATCH leaves the other field alone, and explicit null returns to automatic', async () => {
    const auth = await signIn()
    await patchMe(auth, { displayName: 'Dana', avatarTone: 3 })

    expect((await patchMe(auth, { displayName: 'Dana Levi' })).json()).toMatchObject({
      displayName: 'Dana Levi',
      avatarTone: 3,
    })
    expect((await patchMe(auth, { avatarTone: null })).json()).toMatchObject({
      displayName: 'Dana Levi',
      avatarTone: null,
    })
  })

  it('refuses a tone outside 1..8 and an empty name before touching the row', async () => {
    const auth = await signIn()
    expect((await patchMe(auth, { avatarTone: 0 })).statusCode).toBe(400)
    expect((await patchMe(auth, { avatarTone: 9 })).statusCode).toBe(400)
    expect((await patchMe(auth, { displayName: '   ' })).statusCode).toBe(400)
    expect((await me(auth)).json()).toMatchObject({ avatarTone: null })
  })

  it('needs a session', async () => {
    expect((await patchMe('', { avatarTone: 2 })).statusCode).toBe(401)
    expect(
      (await changePassword('', { currentPassword: 'x', newPassword: 'longenough1' })).statusCode,
    ).toBe(401)
  })

  it('change-password refuses a wrong current password with its own code, changing nothing', async () => {
    const auth = await signIn()
    const refused = await changePassword(auth, {
      currentPassword: 'not-the-password',
      newPassword: 'brand-new-password',
    })
    expect(refused.statusCode).toBe(403)
    expect(refused.json()).toEqual({ error: 'wrong_password' })

    // The old password still signs in; the new one never did.
    await signIn(SEED_PASSWORD)
    const rejected = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: 'brand-new-password' },
    })
    expect(rejected.statusCode).toBe(401)
  })

  it('change-password refuses a too-short new password at the schema', async () => {
    const auth = await signIn()
    const response = await changePassword(auth, {
      currentPassword: SEED_PASSWORD,
      newPassword: 'short',
    })
    expect(response.statusCode).toBe(400)
  })

  it('change-password keeps this session, ends the others, and the new password signs in', async () => {
    const here = await signIn()
    const elsewhere = await signIn()
    expect((await me(elsewhere)).statusCode).toBe(200)

    const changed = await changePassword(here, {
      currentPassword: SEED_PASSWORD,
      newPassword: 'brand-new-password',
    })
    expect(changed.statusCode).toBe(200)

    // The device that changed it carries on; the other one is signed out.
    expect((await me(here)).statusCode).toBe(200)
    expect((await me(elsewhere)).statusCode).toBe(401)

    // And sign-in now takes the new password only.
    await signIn('brand-new-password')
    const old = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
    })
    expect(old.statusCode).toBe(401)
  })
})
