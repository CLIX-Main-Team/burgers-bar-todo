import type { UserSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Invite create and accept (#31): an inviter creates an invite under the provisioning
// constraints, the invitee gets a one-time-link email, follows it, sets a password, and
// is signed straight in. Every assertion is at the HTTP seam — a pending user seen
// through GET /users, a mail seen through the capturing fake, a token proven by driving
// the emailed link back through accept — never by reading rows, a hash, or a token at
// rest (auth plan, testing approach). The injected clock and fake mailer are the only
// substitutions.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
// Two pinned Location ids the beforeEach seeds as real `locations` rows, so users.location_id's
// FK is satisfied (#130). Fixed ids keep the own-vs-other-Location cases legible.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const LOC_B = '22222222-2222-2222-2222-222222222222'
const GOOD_PASSWORD = 'valid-password-123'

describe('auth: invite create and accept (#31)', () => {
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

  const me = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })

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

  // Pull the raw one-time token out of the most recently captured invite mail — the same
  // link the recipient would open. The token is base64url, so it is a run of url-safe
  // characters after `token=`.
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

  // --- Invite creation and provisioning constraints ---

  it('TC-INV-01 — admin invites any role to any Location; each appears invited with baked values', async () => {
    const token = await adminToken()

    const employee = await createInvite(token, {
      email: 'emp@burgers.local',
      displayName: 'Emp One',
      role: 'employee',
      locationId: LOC_A,
    })
    const manager = await createInvite(token, {
      email: 'mgr@burgers.local',
      displayName: 'Mgr One',
      role: 'manager',
      locationId: LOC_B,
    })
    const admin = await createInvite(token, {
      email: 'adm@burgers.local',
      displayName: 'Adm Two',
      role: 'admin',
    })

    for (const res of [employee, manager, admin]) {
      expect(res.statusCode).toBe(201)
      expect(res.json<UserSummary>().status).toBe('invited')
    }
    expect(employee.json<UserSummary>()).toMatchObject({ role: 'employee', locationId: LOC_A })
    expect(manager.json<UserSummary>()).toMatchObject({ role: 'manager', locationId: LOC_B })
    expect(admin.json<UserSummary>()).toMatchObject({ role: 'admin', locationId: null })

    // And each is observable through the list with the same baked values.
    expect(await findUser(token, 'emp@burgers.local')).toMatchObject({
      role: 'employee',
      locationId: LOC_A,
      status: 'invited',
    })
    expect(await findUser(token, 'mgr@burgers.local')).toMatchObject({
      role: 'manager',
      locationId: LOC_B,
    })
    expect(await findUser(token, 'adm@burgers.local')).toMatchObject({
      role: 'admin',
      locationId: null,
    })
  })

  it('TC-INV-02 — a manager invites an employee to their own Location and it succeeds', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)

    const created = await createInvite(managerToken, {
      email: 'emp-a@burgers.local',
      displayName: 'Emp A',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<UserSummary>()).toMatchObject({
      role: 'employee',
      locationId: LOC_A,
      status: 'invited',
    })
    // Visible in the manager's own scoped list.
    expect(await findUser(managerToken, 'emp-a@burgers.local')).toMatchObject({ status: 'invited' })
  })

  it('TC-INV-03 — a manager cannot invite a Manager; refused, no user created', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)

    const res = await createInvite(managerToken, {
      email: 'mgr2@burgers.local',
      displayName: 'Mgr Two',
      role: 'manager',
      locationId: LOC_A,
    })
    expect(res.statusCode).toBe(403)
    expect(await findUser(await adminToken(), 'mgr2@burgers.local')).toBeUndefined()
  })

  it('TC-INV-04 — a manager cannot invite an Admin; refused, no user created', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)

    const res = await createInvite(managerToken, {
      email: 'adm2@burgers.local',
      displayName: 'Adm Two',
      role: 'admin',
    })
    expect(res.statusCode).toBe(403)
    expect(await findUser(await adminToken(), 'adm2@burgers.local')).toBeUndefined()
  })

  it('TC-INV-05 — a manager cannot invite to another Location; refused, no user created', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)

    const res = await createInvite(managerToken, {
      email: 'emp-b@burgers.local',
      displayName: 'Emp B',
      role: 'employee',
      locationId: LOC_B,
    })
    expect(res.statusCode).toBe(403)
    expect(await findUser(await adminToken(), 'emp-b@burgers.local')).toBeUndefined()
  })

  it('TC-INV-06 — client-supplied role/Location cannot influence the outcome', async () => {
    const managerToken = await provisionManager('mgr-a@burgers.local', LOC_A)

    // A manager cannot use the body to reach past their remit: neither a foreign Location
    // nor an elevated role takes effect — both are refused, and no user is created.
    const foreignLocation = await createInvite(managerToken, {
      email: 'smuggle-loc@burgers.local',
      displayName: 'Nope',
      role: 'employee',
      locationId: LOC_B,
    })
    expect(foreignLocation.statusCode).toBe(403)

    const elevatedRole = await createInvite(managerToken, {
      email: 'smuggle-role@burgers.local',
      displayName: 'Nope',
      role: 'admin',
      locationId: LOC_A,
    })
    expect(elevatedRole.statusCode).toBe(403)

    const adminView = await adminToken()
    expect(await findUser(adminView, 'smuggle-loc@burgers.local')).toBeUndefined()
    expect(await findUser(adminView, 'smuggle-role@burgers.local')).toBeUndefined()

    // And when a manager omits the Location, the server bakes in their own — the baked
    // value wins rather than any client input.
    const omitted = await createInvite(managerToken, {
      email: 'own-loc@burgers.local',
      displayName: 'Fine',
      role: 'employee',
    })
    expect(omitted.statusCode).toBe(201)
    expect(omitted.json<UserSummary>()).toMatchObject({ locationId: LOC_A })
  })

  it('TC-INV-07 — the display name supplied at create is the one observed on the pending user', async () => {
    const token = await adminToken()
    const created = await createInvite(token, {
      email: 'named@burgers.local',
      displayName: 'Dana Cohen',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<UserSummary>().displayName).toBe('Dana Cohen')
    expect((await findUser(token, 'named@burgers.local'))?.displayName).toBe('Dana Cohen')
  })

  it('TC-INV-08 — creating an invite captures exactly one outbound mail with a usable link', async () => {
    const token = await adminToken()
    const created = await createInvite(token, {
      email: 'mailed@burgers.local',
      displayName: 'Mailed User',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)

    // Exactly one mail, to the invitee.
    expect(harness.mailer.sent).toHaveLength(1)
    expect(harness.mailer.sent[0].to).toBe('mailed@burgers.local')

    // The link is usable: driving its token through accept signs the invitee in.
    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json<{ token: string }>().token).toBeTruthy()
  })

  it('TC-INV-09 — the invited user is present in the list with status invited before acceptance', async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'pending@burgers.local',
      displayName: 'Pending User',
      role: 'employee',
      locationId: LOC_A,
    })
    // No accept has happened; the user is already visible as invited.
    expect(await findUser(token, 'pending@burgers.local')).toMatchObject({ status: 'invited' })
  })

  it('inviting an already-taken email is a clean conflict, not a 500, and mails nothing', async () => {
    const token = await adminToken()
    const first = await createInvite(token, {
      email: 'dup@burgers.local',
      displayName: 'First',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(first.statusCode).toBe(201)

    // A second invite for the same address (any case) conflicts on the unique email; the
    // recipient is not re-created and no second mail goes out (resend is #32).
    const second = await createInvite(token, {
      email: 'DUP@burgers.local',
      displayName: 'Second',
      role: 'employee',
      locationId: LOC_A,
    })
    expect(second.statusCode).toBe(409)
    expect(harness.mailer.sent).toHaveLength(1)
  })

  // --- Accept ---

  it('TC-ACC-01 — accept sets password, activates, signs in, and authenticates a principal read', async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'accepter@burgers.local',
      displayName: 'Accepter',
      role: 'employee',
      locationId: LOC_A,
    })

    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    const session = accepted.json<{ token: string }>().token

    // The returned session authenticates a current-principal read straight away.
    const principal = await me(session)
    expect(principal.statusCode).toBe(200)
    expect(principal.json()).toMatchObject({
      role: 'employee',
      locationId: LOC_A,
      status: 'active',
    })

    // Status is now active: a later independent sign-in with the new password succeeds.
    expect((await signIn('accepter@burgers.local', GOOD_PASSWORD)).statusCode).toBe(200)
  })

  it('TC-ACC-02 — the preferred_language chosen at accept is observable afterwards', async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'lang@burgers.local',
      displayName: 'Lang User',
      role: 'employee',
      locationId: LOC_A,
    })

    // Choose the non-default language (default is he) so the save is what we observe.
    expect((await accept(latestInviteToken(), GOOD_PASSWORD, 'en')).statusCode).toBe(200)
    expect((await findUser(token, 'lang@burgers.local'))?.preferredLanguage).toBe('en')
  })

  it('TC-ACC-03 — a too-short password is refused; the user stays invited and the token is not consumed', async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'short@burgers.local',
      displayName: 'Short Pw',
      role: 'employee',
      locationId: LOC_A,
    })
    const rawToken = latestInviteToken()

    // Below the shared minimum length: refused before anything is consumed.
    const tooShort = await accept(rawToken, 'short', 'he')
    expect(tooShort.statusCode).toBe(400)

    // The user is still invited: a sign-in attempt fails (no password was set).
    expect((await signIn('short@burgers.local', 'short')).statusCode).toBe(401)
    expect((await findUser(token, 'short@burgers.local'))?.status).toBe('invited')

    // The token was not consumed: the same link still accepts with a valid password.
    const retry = await accept(rawToken, GOOD_PASSWORD, 'he')
    expect(retry.statusCode).toBe(200)
  })

  it('TC-ACC-06 — a mismatched or unknown token is rejected and creates no session', async () => {
    const bogus = await accept('not-a-real-token', GOOD_PASSWORD)
    expect(bogus.statusCode).toBe(400)
    expect(bogus.json()).not.toHaveProperty('token')
  })

  // --- Sign-in ---

  it('TC-LOGIN-04 — an invited (not-yet-accepted) user is refused sign-in with the generic failure', async () => {
    const token = await adminToken()
    await createInvite(token, {
      email: 'invited@burgers.local',
      displayName: 'Invited Only',
      role: 'employee',
      locationId: LOC_A,
    })

    // Never accepted, so no password exists; sign-in gives the same generic failure a
    // wrong password would, never a hint that the account is merely pending.
    const res = await signIn('invited@burgers.local', GOOD_PASSWORD)
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'invalid_credentials' })
  })
})
