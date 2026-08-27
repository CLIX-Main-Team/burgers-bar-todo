import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The board route in front of the knowledge scan (owner ask 2026-08-27), end to end over real HTTP.
// The scan's own behaviour is unit-tested in checklist-scan.test.ts against a fake model; what the
// ROUTE owns is who may reach the corpus at all and how a model outage is reported, so these cases
// assert exactly that — including that a refused caller never reaches the scan, rather than merely
// receiving a different status code from it.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

describe('checklist scan: the chain owner reaches it, nobody else does', () => {
  let harness: TestHarness
  let owner: string
  let locationId: string

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
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

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  const provision = async (
    email: string,
    displayName: string,
    role: 'admin' | 'manager' | 'employee',
    forLocation: string | null,
  ): Promise<string> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${owner}` },
      payload: { email, displayName, role, locationId: forLocation },
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

  const scan = (token: string | null, title: unknown): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks/checklist-scan',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: { title } as Record<string, unknown>,
    })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    locationId = (await harness.seedLocation({ name: 'Downtown' })).id
  })

  it('hands the chain owner the steps it found, and the document behind them', async () => {
    harness.checklistScan.respondWith({
      status: 'ok',
      steps: ['חתימה על הסכם השכירות', 'פתיחת תיק במס הכנסה'],
      sourceTitle: 'צק ליסט פתיחת סניף',
    })

    const response = await scan(owner, 'פתיחת סניף חדש')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      steps: ['חתימה על הסכם השכירות', 'פתיחת תיק במס הכנסה'],
      sourceTitle: 'צק ליסט פתיחת סניף',
    })
    // The title the person typed is what was searched for — no rewriting on the way in.
    expect(harness.checklistScan.titles).toEqual(['פתיחת סניף חדש'])
  })

  it('finding nothing is a 200 with no steps, not an error', async () => {
    const response = await scan(owner, 'Order more napkins')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ steps: [], sourceTitle: null })
  })

  it('reports a model outage as a retryable 503', async () => {
    harness.checklistScan.respondWith({ status: 'unavailable' })

    const response = await scan(owner, 'פתיחת סניף חדש')

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'scan_unavailable' })
  })

  it.each([
    ['a branch admin', 'admin' as const],
    ['a manager', 'manager' as const],
    ['an employee', 'employee' as const],
  ])('refuses %s, and the corpus is never read', async (_label, role) => {
    const token = await provision(`scan-${role}@burgers.local`, `A ${role}`, role, locationId)

    const response = await scan(token, 'פתיחת סניף חדש')

    expect(response.statusCode).toBe(403)
    expect(harness.checklistScan.titles).toEqual([])
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await scan(null, 'פתיחת סניף חדש')

    expect(response.statusCode).toBe(401)
    expect(harness.checklistScan.titles).toEqual([])
  })

  it('refuses an empty title without spending a scan', async () => {
    const response = await scan(owner, '   ')

    expect(response.statusCode).toBe(400)
    expect(harness.checklistScan.titles).toEqual([])
  })
})
