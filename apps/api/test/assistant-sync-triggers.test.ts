import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GOOGLE_DOC_MIME_TYPE } from '../src/assistant/drive-client.js'
import { BACKSTOP_POLL_INTERVAL_MS } from '../src/assistant/sync-triggers.js'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type AssistantAppHarness, createAssistantAppHarness } from './helpers/assistant-app.js'

// Assistant Drive-sync triggers (#89, ADR-0021): the two triggers that keep the knowledge cache
// current without a push channel — a ~20-minute interval poll driven by the injected clock, and a
// manager/admin "resync now" endpoint enforced through the ADR-0007 API path. Both drive the one
// single-flight reconciliation pass, so an interval tick during a resync collapses to one sync in
// flight. Login no longer touches Drive (ADR-0021 reverses ADR-0014's login trigger). Every
// assertion is external-behaviour-only — HTTP status/body, cache state seen through a follow-up
// read, and the fake Drive's call counts — driven deterministically through the fake Drive port and
// the mutable clock.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'
// A pinned Location id the beforeEach seeds as a real `locations` row, so users.location_id's FK
// is satisfied (#130); a fixed id keeps the case legible.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const DOC_MIME = GOOGLE_DOC_MIME_TYPE

describe('assistant: Drive-sync triggers (#89)', () => {
  let harness: AssistantAppHarness

  beforeAll(async () => {
    harness = await createAssistantAppHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.auth.repo, harness.auth.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    // Seed the Location these cases provision employees into, so the FK on users.location_id resolves.
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
  })

  // --- knowledge-doc scripting, all through the fake Drive port / the module's own reads ---

  // Reconcile once to seed the changes cursor at the current end of the feed, the way provisioning
  // seeds it before authors add docs (ADR-0014). Docs authored after this are what a later sync sees.
  const seedCursor = () => harness.assistant.syncService.reconcile()

  const putDoc = (
    fileId: string,
    name: string,
    content: string,
    modifiedTime = '2026-02-01T00:00:00.000Z',
  ) => harness.drive.putDoc(fileId, { name, mimeType: DOC_MIME, content, modifiedTime })

  const readDoc = (driveFileId: string) => harness.assistant.repo.getDocByDriveFileId(driveFileId)

  const ingestedIds = async () =>
    (await harness.assistant.repo.listIngestedDocs()).map((doc) => doc.driveFileId)

  // Drain any in-flight (or just-triggered) sync so a fire-and-forget login sync settles before the
  // test asserts or tears down; coalesces onto an in-flight pass rather than starting a rogue one.
  const drainSync = () => harness.assistant.syncService.reconcile().catch(() => {})

  // --- HTTP helpers, driving the seam the running app exposes ---

  const signIn = (email: string, password: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email, password } })

  const signInToken = async (email: string, password: string): Promise<string> => {
    const login = await signIn(email, password)
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const adminToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

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

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  // Provision an active user of a given role the realistic way — an admin invites, they accept —
  // so the role guard runs against a genuine session for that role.
  const provisionUser = async (role: 'manager' | 'employee', email: string): Promise<string> => {
    const created = await createInvite(await adminToken(), {
      email,
      displayName: `A ${role}`,
      role,
      locationId: LOC_A,
    })
    expect(created.statusCode).toBe(201)
    const accepted = await accept(latestInviteToken(), GOOD_PASSWORD)
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const resync = (token?: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/assistant/resync',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })

  // --- AC2: the ~20-minute interval poll fires on the injected clock and reconciles ---

  it('AC2 — the interval poll fires only after the interval elapses on the injected clock', async () => {
    await seedCursor()
    // An author edits a doc during a long-lived process between interval ticks.
    putDoc('doc-1', 'Allergen list', 'Contains peanuts.')

    // Before the interval elapses, a tick is a no-op — the edit is not yet reconciled.
    await harness.assistant.syncTriggers.pollBackstop()
    expect(await readDoc('doc-1')).toBeUndefined()

    // Advance the injected clock across the interval: the interval poll fires and reconciles.
    harness.clock.advance(BACKSTOP_POLL_INTERVAL_MS)
    await harness.assistant.syncTriggers.pollBackstop()
    expect(await readDoc('doc-1')).toBeDefined()

    // The window resets: an immediate second tick, no time having passed, walks Drive no further.
    const walks = harness.drive.calls.listChanges
    await harness.assistant.syncTriggers.pollBackstop()
    expect(harness.drive.calls.listChanges).toBe(walks)
  })

  // --- AC3: the manager/admin resync endpoint, enforced through the ADR-0007 API path ---

  it('AC3 — resync makes a just-changed doc answerable (admin seeds, manager makes it live)', async () => {
    // An admin's first resync seeds the cursor at the current end of the feed.
    const admin = await adminToken()
    expect((await resync(admin)).statusCode).toBe(200)

    // The policy is changed in Drive after seeding — not yet answerable.
    putDoc('policy-1', 'Refund policy', 'Refunds within 30 days.')
    expect(await ingestedIds()).not.toContain('policy-1')

    // A manager hits "resync now": the endpoint awaits the reconcile, so on its 200 the just-changed
    // doc is part of the answerable knowledge cache.
    const manager = await provisionUser('manager', 'mgr@burgers.local')
    expect((await resync(manager)).statusCode).toBe(200)
    expect(await ingestedIds()).toContain('policy-1')

    await drainSync()
  })

  it('AC3 — resync is denied to an employee (ADR-0007) and refused without a session', async () => {
    const employee = await provisionUser('employee', 'emp@burgers.local')
    expect((await resync(employee)).statusCode).toBe(403)
    // And an unauthenticated caller is refused outright.
    expect((await resync()).statusCode).toBe(401)

    await drainSync()
  })
})
