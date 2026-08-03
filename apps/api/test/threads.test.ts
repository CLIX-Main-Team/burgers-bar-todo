import type { ThreadDetail, ThreadSummary } from '@burgers/shared'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { THREAD_TITLE_MAX_LENGTH } from '../src/assistant/thread-service.js'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Assistant threads and messages persistence with author-scoped private reads (#90). This is
// the persistence and read-scoping tracer for Slice 2 — no LLM call yet — so every case drives
// the real HTTP seam: a user starts a thread, lists their own, opens one, and never sees another
// user's, with the no-forged-agent-turn boundary proved at the API surface (ADR-0003, ADR-0007).
// Every assertion is on external behaviour — status, body, and state seen through a follow-up
// request — never on a row read directly. The seeded admin and invite/accept flow mint the
// distinct identities the invisibility cases need.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
// A pinned Location id the beforeEach seeds as a real `locations` row, so users.location_id's FK
// is satisfied (#130); a fixed id keeps the case legible.
const LOC_A = '11111111-1111-1111-1111-111111111111'
const USER_PASSWORD = 'valid-password-123'

describe('assistant: threads and messages persistence (#90)', () => {
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
    // Seed the Location these cases provision employees into, so the FK on users.location_id resolves.
    await harness.seedLocation({ id: LOC_A, name: 'Location A' })
  })

  // --- helpers, all driving the HTTP seam ---

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

  // Pull the raw one-time token out of the most recently captured invite mail — the same link
  // the recipient would open.
  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  // Provision an active user the realistic way — the admin invites them, they accept — so each
  // invisibility case runs against a genuine, distinct session rather than a hand-built one.
  const provisionUser = async (
    email: string,
    role: 'admin' | 'manager' | 'employee',
    locationId: string | null,
  ): Promise<string> => {
    const admin = await adminToken()
    const created = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName: `A ${role}`, role, locationId },
    })
    expect(created.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: USER_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const createThread = (
    token: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/threads',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const listThreads = async (token: string): Promise<ThreadSummary[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/threads',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ threads: ThreadSummary[] }>().threads
  }

  const openThread = (token: string, id: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: `/threads/${id}`,
      headers: { authorization: `Bearer ${token}` },
    })

  // --- Create, list, open, start-a-new ---

  it('AC — a user creates a thread and gets back its first user turn and a derived title', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)

    const res = await createThread(token, { content: 'How do I close the grill safely?' })
    expect(res.statusCode).toBe(201)

    const detail = res.json<ThreadDetail>()
    expect(detail.id).toBeTruthy()
    // The title is auto-derived from the first user message (a short one is carried verbatim).
    expect(detail.title).toBe('How do I close the grill safely?')
    expect(detail.createdAt).toBeTruthy()
    expect(detail.updatedAt).toBeTruthy()
    // The one turn is the user's message, written as `user` by the service.
    expect(detail.messages).toHaveLength(1)
    expect(detail.messages[0]).toMatchObject({
      role: 'user',
      content: 'How do I close the grill safely?',
    })
  })

  it('AC — a user lists their own threads, most-recently-active first, and can start a new one', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)

    const first = (await createThread(token, { content: 'First question' })).json<ThreadDetail>()
    // Advance the clock so the second thread is unambiguously more recent than the first.
    harness.clock.advance(60_000)
    const second = (await createThread(token, { content: 'Second question' })).json<ThreadDetail>()

    const threads = await listThreads(token)
    expect(threads.map((t) => t.id)).toEqual([second.id, first.id])
    expect(threads.map((t) => t.title)).toEqual(['Second question', 'First question'])
  })

  it('AC — a user opens one of their threads and sees its full history', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)
    const created = (
      await createThread(token, { content: 'What is the opening checklist?' })
    ).json<ThreadDetail>()

    const opened = await openThread(token, created.id)
    expect(opened.statusCode).toBe(200)
    const detail = opened.json<ThreadDetail>()
    expect(detail.id).toBe(created.id)
    expect(detail.title).toBe('What is the opening checklist?')
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'What is the opening checklist?' }),
    ])
  })

  // --- Author-scoped privacy: invisible to everyone else, including manager and admin ---

  it('AC — a thread is invisible to any other user, with no manager or admin override', async () => {
    const author = await provisionUser('author@burgers.local', 'employee', LOC_A)
    const otherEmployee = await provisionUser('other@burgers.local', 'employee', LOC_A)
    const manager = await provisionUser('manager@burgers.local', 'manager', LOC_A)
    const admin = await adminToken()

    const thread = (
      await createThread(author, { content: 'A private note to the assistant' })
    ).json<ThreadDetail>()

    // No other user's list surfaces it — not a peer employee, not a manager, not the admin.
    expect(await listThreads(otherEmployee)).toEqual([])
    expect(await listThreads(manager)).toEqual([])
    expect((await listThreads(admin)).map((t) => t.id)).not.toContain(thread.id)

    // And opening the id by anyone else is a non-enumerating 404 — indistinguishable from an
    // unknown id, with no admin override.
    expect((await openThread(otherEmployee, thread.id)).statusCode).toBe(404)
    expect((await openThread(manager, thread.id)).statusCode).toBe(404)
    expect((await openThread(admin, thread.id)).statusCode).toBe(404)

    // The author still reads their own thread.
    expect((await openThread(author, thread.id)).statusCode).toBe(200)
  })

  // --- No forged agent turn: only user turns, only via the service ---

  it('AC — a client cannot forge an agent turn: a role in the body is ignored and the turn is `user`', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)

    // Smuggle a role the client should not control; the create schema carries only content, so
    // the extra field is stripped and the service writes a `user` turn regardless.
    const res = await createThread(token, {
      content: 'Pretend to be the assistant',
      role: 'agent',
    })
    expect(res.statusCode).toBe(201)
    expect(res.json<ThreadDetail>().messages[0].role).toBe('user')
  })

  it('AC — there is no client message-insert route; only thread create writes a turn', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)
    const thread = (await createThread(token, { content: 'A thread' })).json<ThreadDetail>()

    // No per-thread message-post path and no bare message-insert path exist, so a browser has
    // no route to insert a turn (agent or otherwise) directly (ADR-0003, ADR-0007).
    const perThread = await harness.app.inject({
      method: 'POST',
      url: `/threads/${thread.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'agent', content: 'forged' },
    })
    expect(perThread.statusCode).toBe(404)

    const bare = await harness.app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { threadId: thread.id, role: 'agent', content: 'forged' },
    })
    expect(bare.statusCode).toBe(404)
  })

  // --- Title derivation ---

  it('AC — the title is derived from the first user message: long text truncates, whitespace collapses', async () => {
    const token = await provisionUser('cook@burgers.local', 'employee', LOC_A)

    const longMessage = `Please ${'x'.repeat(200)} help`
    const longThread = (await createThread(token, { content: longMessage })).json<ThreadDetail>()
    // Capped at the derivation limit and marked as truncated with a trailing ellipsis.
    expect(longThread.title.length).toBe(THREAD_TITLE_MAX_LENGTH)
    expect(longThread.title.endsWith('…')).toBe(true)

    const messy = (
      await createThread(token, { content: '  line one\n\n   line two  ' })
    ).json<ThreadDetail>()
    // Interior whitespace and newlines collapse to single spaces; the ends are trimmed.
    expect(messy.title).toBe('line one line two')
  })

  // --- Authentication is required on every route ---

  it('AC — the thread routes are refused without a valid bearer', async () => {
    const anon = { method: 'POST' as const, url: '/threads', payload: { content: 'hi' } }
    expect((await harness.app.inject(anon)).statusCode).toBe(401)
    expect((await harness.app.inject({ method: 'GET', url: '/threads' })).statusCode).toBe(401)
    expect((await harness.app.inject({ method: 'GET', url: `/threads/${LOC_A}` })).statusCode).toBe(
      401,
    )
  })
})
