import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GOOGLE_DOC_MIME_TYPE } from '../src/assistant/drive-client.js'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type AssistantAppHarness, createAssistantAppHarness } from './helpers/assistant-app.js'

// The Knowledge tab's listing endpoint (ADR-0024): GET /assistant/knowledge returns every
// cached Knowledge Doc's filing metadata — Drive folder, status, skip reason, Drive id — plus the
// last sync time, for admins and managers only (the same ADR-0007 tier the resync admits).
// Assertions are external-behaviour-only: HTTP status and body after syncs driven through the
// fake Drive and fake LLM, never a raw row select.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'
const LOC_A = '11111111-1111-1111-1111-111111111111'

describe('assistant: Knowledge tab listing endpoint (ADR-0024)', () => {
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
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
  })

  const putDoc = (fileId: string, name: string, content: string, folderName?: string) =>
    harness.drive.putDoc(fileId, {
      name,
      mimeType: GOOGLE_DOC_MIME_TYPE,
      content,
      modifiedTime: '2026-02-01T00:00:00.000Z',
      folderName,
    })

  const signInToken = async (email: string, password: string): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(login.statusCode).toBe(200)
    return login.json<{ token: string }>().token
  }

  const adminToken = (): Promise<string> => signInToken(SEED_EMAIL, SEED_PASSWORD)

  // Provision an active user of a given role the realistic way — an admin invites, they accept —
  // so the role guard runs against a genuine session for that role.
  const provisionUser = async (role: 'manager' | 'employee', email: string): Promise<string> => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${await adminToken()}` },
      payload: { email, displayName: `${role} user`, role, locationId: LOC_A },
    })
    expect(created.statusCode).toBe(201)
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: {
        token: (match as RegExpExecArray)[1],
        password: GOOD_PASSWORD,
        preferredLanguage: 'en',
      },
    })
    expect(accepted.statusCode).toBe(200)
    return signInToken(email, GOOD_PASSWORD)
  }

  const listKnowledge = (token?: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/assistant/knowledge',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })

  it('an admin reads the filed corpus: folder, status, Drive id, and the last sync time', async () => {
    // Filed in a Drive folder, so the listing has a folder to carry; the second sits at the
    // corpus root, where a null folder is the honest answer rather than an invented shelf.
    putDoc('doc-pay', 'צק ליסט משכורות', 'תהליך המשכורות', 'כספים')
    putDoc('doc-open', 'נוהל פתיחת סניף', 'שלבי פתיחה')
    await harness.assistant.syncService.reconcile()

    const res = await listKnowledge(await adminToken())

    expect(res.statusCode).toBe(200)
    const body = res.json<{
      docs: Array<Record<string, unknown>>
      lastSyncAt: string | null
    }>()
    expect(body.lastSyncAt).toBe('2026-01-01T00:00:00.000Z')
    expect(body.docs).toHaveLength(2)
    const pay = body.docs.find((d) => d.driveFileId === 'doc-pay')
    expect(pay).toMatchObject({
      title: 'צק ליסט משכורות',
      folder: 'כספים',
      status: 'ingested',
      skipReason: null,
      sourceMimeType: GOOGLE_DOC_MIME_TYPE,
      driveModifiedTime: '2026-02-01T00:00:00.000Z',
    })
    expect(body.docs.find((d) => d.driveFileId === 'doc-open')?.folder).toBeNull()
    // The extracted text never crosses this wire — the tab links to Drive, it doesn't mirror.
    expect(pay).not.toHaveProperty('content')
  })

  it('a manager reads the same listing — the tab is a manager surface too', async () => {
    putDoc('doc-1', 'נוהל', 'תוכן')
    await harness.assistant.syncService.reconcile()

    const res = await listKnowledge(await provisionUser('manager', 'manager@example.com'))

    expect(res.statusCode).toBe(200)
    expect(res.json<{ docs: unknown[] }>().docs).toHaveLength(1)
  })

  it('an employee is refused flat, and no session is refused unauthenticated', async () => {
    expect(
      (await listKnowledge(await provisionUser('employee', 'emp@example.com'))).statusCode,
    ).toBe(403)
    expect((await listKnowledge()).statusCode).toBe(401)
  })

  it('before any sync, the listing is empty with no last-sync time — never an error', async () => {
    const res = await listKnowledge(await adminToken())

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ docs: [], lastSyncAt: null })
  })
})
