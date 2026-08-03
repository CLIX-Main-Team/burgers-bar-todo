import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Password reset request and consume (#34): self-service recovery that leaks nothing about
// which emails exist and cuts every compromised session the moment the account is
// recovered. Every assertion is at the HTTP seam — the generic confirmation, a captured
// reset mail driven back through consume, a refused sign-in or session — never by reading
// rows or token values directly (auth plan, testing approach). The injected clock drives
// the ~1h expiry; the capturing fake mailer carries the one-time link.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
// A pinned Location id the beforeEach seeds as a real `locations` row, so users.location_id's
// FK is satisfied (#130); a fixed id keeps the case legible.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const OLD_PASSWORD = 'valid-password-123'
const NEW_PASSWORD = 'brand-new-password-456'
const ONE_HOUR_MS = 60 * 60 * 1000

// The generic confirmation every reset request returns, whatever the outcome.
const RESET_ACK = { status: 'ok' }

describe('auth: password reset request and consume (#34)', () => {
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
    // Seed the Location these cases invite into, so the FK on users.location_id resolves.
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
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

  const me = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

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

  const accept = (token: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token, password, preferredLanguage: 'en' },
    })

  const deactivate = (token: string, userId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/users/${userId}/deactivate`,
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

  // Reset request: `ip` is passed as the connection's remote address so request.ip reflects
  // it (no trustProxy), which is how the per-IP rate-limit cases vary the IP.
  const resetRequest = (email: string, ip?: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/reset-request',
      payload: { email },
      ...(ip ? { remoteAddress: ip } : {}),
    })

  const resetConsume = (token: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/auth/reset-consume',
      payload: { token, password },
    })

  // Only the reset mails, so the invite mail from provisioning never confuses a count.
  const resetMails = (): { to: string; text: string }[] =>
    harness.mailer.sent.filter((m) => m.subject === 'Reset your Burgers Bar password')

  // Pull the one-time token out of a mail's link — the only supported way to reach it, since
  // the raw token is never stored (ADR-0006). Shared by the invite and reset link extraction.
  const tokenFromMail = (mail: { text: string } | undefined): string => {
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  const latestResetToken = (): string => tokenFromMail(resetMails().at(-1))

  // Provision an active employee the realistic way — an admin invites them, they accept —
  // so reset runs against a genuine active, password-bearing user. Returns their id and a
  // live session token from the accept.
  const provisionEmployee = async (email: string): Promise<{ id: string; session: string }> => {
    const admin = await adminToken()
    const created = await createInvite(admin, {
      email,
      displayName: 'An Employee',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)
    const accepted = await accept(tokenFromMail(harness.mailer.sent.at(-1)), OLD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    const user = await findUser(admin, email)
    expect(user).toBeDefined()
    return { id: (user as UserSummary).id, session: accepted.json<{ token: string }>().token }
  }

  // --- Request: non-enumeration ---

  it("TC-RESET-01 — an active user's request captures one mail with a usable link", async () => {
    await provisionEmployee('emp1@burgers.local')

    const res = await resetRequest('emp1@burgers.local')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(RESET_ACK)

    // Exactly one reset mail, and its link actually works — consumed below with a new
    // password, then that password signs in (the full happy path in one place).
    expect(resetMails()).toHaveLength(1)
    const consumed = await resetConsume(latestResetToken(), NEW_PASSWORD)
    expect(consumed.statusCode).toBe(200)
    expect((await signIn('emp1@burgers.local', NEW_PASSWORD)).statusCode).toBe(200)
  })

  it('TC-RESET-02 — an unknown email returns the same response and captures no mail', async () => {
    const res = await resetRequest('nobody@burgers.local')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(RESET_ACK)
    expect(resetMails()).toHaveLength(0)
  })

  it('TC-RESET-03 — an invited (not-yet-accepted) email returns the same response and captures no mail', async () => {
    const admin = await adminToken()
    // Create the invite but never accept it, so the user is still status invited.
    expect(
      (
        await createInvite(admin, {
          email: 'invited@burgers.local',
          displayName: 'Pending',
          role: 'employee',
          locationId: LOC_A,
        })
      ).statusCode,
    ).toBe(201)

    const res = await resetRequest('invited@burgers.local')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(RESET_ACK)
    // No reset mail — an invited user has no password to reset (only the invite mail exists).
    expect(resetMails()).toHaveLength(0)
  })

  it('TC-RESET-04 — a deactivated email returns the same response, captures no mail, and yields no usable token', async () => {
    const { id } = await provisionEmployee('emp4@burgers.local')
    expect((await deactivate(await adminToken(), id)).statusCode).toBe(200)

    const res = await resetRequest('emp4@burgers.local')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(RESET_ACK)
    // No mail, so no token was produced for a cut-off account (stories 27, 33).
    expect(resetMails()).toHaveLength(0)
  })

  // --- Consume ---

  it('TC-RESET-05 — consuming a valid token with a valid password sets the new password', async () => {
    await provisionEmployee('emp5@burgers.local')
    expect((await resetRequest('emp5@burgers.local')).statusCode).toBe(200)

    const consumed = await resetConsume(latestResetToken(), NEW_PASSWORD)
    expect(consumed.statusCode).toBe(200)
    expect(consumed.json()).toEqual(RESET_ACK)

    // The new password signs in; the old one no longer does.
    expect((await signIn('emp5@burgers.local', NEW_PASSWORD)).statusCode).toBe(200)
    expect((await signIn('emp5@burgers.local', OLD_PASSWORD)).statusCode).toBe(401)
  })

  it('TC-RESET-06 — consuming with a too-short password is refused and the token is not consumed', async () => {
    await provisionEmployee('emp6@burgers.local')
    expect((await resetRequest('emp6@burgers.local')).statusCode).toBe(200)
    const token = latestResetToken()

    // Both an empty password and a below-minimum one are refused at the schema before the
    // handler runs (400), so the token is never reached.
    expect((await resetConsume(token, '')).statusCode).toBe(400)
    expect((await resetConsume(token, 'short')).statusCode).toBe(400)

    // The token was not spent — a valid password still consumes it and the new one signs in.
    const consumed = await resetConsume(token, NEW_PASSWORD)
    expect(consumed.statusCode).toBe(200)
    expect((await signIn('emp6@burgers.local', NEW_PASSWORD)).statusCode).toBe(200)
  })

  it('TC-RESET-07 — a reset token is single-use: a second consume is rejected', async () => {
    await provisionEmployee('emp7@burgers.local')
    expect((await resetRequest('emp7@burgers.local')).statusCode).toBe(200)
    const token = latestResetToken()

    expect((await resetConsume(token, NEW_PASSWORD)).statusCode).toBe(200)

    const second = await resetConsume(token, 'another-password-789')
    expect(second.statusCode).toBe(400)
    expect(second.json()).toEqual({ error: 'invalid_token' })
    // The second attempt changed nothing — the first new password still signs in.
    expect((await signIn('emp7@burgers.local', NEW_PASSWORD)).statusCode).toBe(200)
  })

  it('TC-RESET-08 — a reset token past its ~1h expiry is rejected at consume', async () => {
    await provisionEmployee('emp8@burgers.local')
    expect((await resetRequest('emp8@burgers.local')).statusCode).toBe(200)
    const token = latestResetToken()

    // Advance just past the one-hour window; the token is now expired.
    harness.clock.advance(ONE_HOUR_MS + 1000)

    const consumed = await resetConsume(token, NEW_PASSWORD)
    expect(consumed.statusCode).toBe(400)
    expect(consumed.json()).toEqual({ error: 'invalid_token' })
    // The password was never changed — the original one still signs in.
    expect((await signIn('emp8@burgers.local', OLD_PASSWORD)).statusCode).toBe(200)
  })

  it('TC-RESET-09 — an unknown/mismatched reset token is rejected', async () => {
    await provisionEmployee('emp9@burgers.local')

    // A token that matches nothing at all.
    const unknown = await resetConsume('not-a-real-token', NEW_PASSWORD)
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json()).toEqual({ error: 'invalid_token' })

    // A real, live token of the wrong purpose — an unaccepted invite token presented to
    // reset-consume — is likewise rejected: consume is scoped to the reset purpose, so an
    // invite token is not a valid reset token even though the value exists in the DB.
    const admin = await adminToken()
    expect(
      (
        await createInvite(admin, {
          email: 'mismatch@burgers.local',
          displayName: 'Pending',
          role: 'employee',
          locationId: LOC_A,
        })
      ).statusCode,
    ).toBe(201)
    const inviteToken = tokenFromMail(harness.mailer.sent.at(-1))
    const wrongPurpose = await resetConsume(inviteToken, NEW_PASSWORD)
    expect(wrongPurpose.statusCode).toBe(400)
    expect(wrongPurpose.json()).toEqual({ error: 'invalid_token' })
  })

  it("TC-RESET-10 — completing a reset revokes every one of the user's sessions", async () => {
    const { session } = await provisionEmployee('emp10@burgers.local')
    // A second live session, standing in for a second device.
    const secondSession = await signInToken('emp10@burgers.local', OLD_PASSWORD)

    // Both authenticate before the reset.
    expect((await me(session)).statusCode).toBe(200)
    expect((await me(secondSession)).statusCode).toBe(200)

    expect((await resetRequest('emp10@burgers.local')).statusCode).toBe(200)
    expect((await resetConsume(latestResetToken(), NEW_PASSWORD)).statusCode).toBe(200)

    // Every pre-existing session is refused on its next request — a compromised session is
    // cut the moment the account is recovered (story 29). No session came back from consume.
    expect((await me(session)).statusCode).toBe(401)
    expect((await me(secondSession)).statusCode).toBe(401)
  })

  it('TC-RESET-11 — a second reset request invalidates the first token', async () => {
    await provisionEmployee('emp11@burgers.local')

    expect((await resetRequest('emp11@burgers.local')).statusCode).toBe(200)
    const firstToken = latestResetToken()
    expect((await resetRequest('emp11@burgers.local')).statusCode).toBe(200)
    const secondToken = latestResetToken()
    expect(secondToken).not.toBe(firstToken)

    // The first link is dead the instant the second is issued.
    expect((await resetConsume(firstToken, NEW_PASSWORD)).statusCode).toBe(400)
    // The freshest link still works.
    expect((await resetConsume(secondToken, NEW_PASSWORD)).statusCode).toBe(200)
    expect((await signIn('emp11@burgers.local', NEW_PASSWORD)).statusCode).toBe(200)
  })

  // --- Rate limiting (throttling leaks no signal) ---

  it('TC-RESET-12 — the per-email rate limit trips while still returning the generic confirmation', async () => {
    await provisionEmployee('emp12@burgers.local')

    // Same email, a fresh IP each request, so only the per-email window can trip (the
    // per-IP window never sees the same IP twice). The limit is 3 (test config): the first
    // three mail, the fourth is throttled — but every response is the same generic ack.
    for (let i = 1; i <= 4; i++) {
      const res = await resetRequest('emp12@burgers.local', `10.0.0.${i}`)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(RESET_ACK)
    }

    // Throttling shows only in the absence of a fourth mail — never in the response.
    expect(resetMails()).toHaveLength(3)
  })

  it('TC-RESET-13 — the per-IP rate limit trips across differing emails, still returning the generic confirmation', async () => {
    // Four active users so an allowed request always produces mail; a throttled one never
    // does. Distinct emails so the per-email window never trips — only the shared IP does.
    for (const email of [
      'ip1@burgers.local',
      'ip2@burgers.local',
      'ip3@burgers.local',
      'ip4@burgers.local',
    ]) {
      await provisionEmployee(email)
    }

    // All from one IP (the default remote address), differing emails. The per-IP limit is 3.
    const emails = [
      'ip1@burgers.local',
      'ip2@burgers.local',
      'ip3@burgers.local',
      'ip4@burgers.local',
    ]
    for (const email of emails) {
      const res = await resetRequest(email)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual(RESET_ACK)
    }

    // The fourth email, though active, is throttled by the shared IP — only three mails.
    expect(resetMails()).toHaveLength(3)
  })
})
