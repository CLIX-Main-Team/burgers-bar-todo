import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type SseClient, openSse } from './helpers/sse-client.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Task board Slice A2 — the scope-filtered live channel (#132, ADR-0015). This is the rule-5
// security test: it stands up a *real listening server*, opens *actual SSE streams* per role over a
// socket, and proves the one property the whole channel exists to guarantee — a change reaches a
// subscriber only if that task is within their read scope at delivery time, filtered by the same
// predicate the read path uses (an out-of-scope task's event is withheld, never merely redacted).
//
// There are no write emitters yet (they land in slices B–D), so a case publishes onto the very
// in-process bus those writes will use (harness.taskBoard.events) — the real fan-out path, not a
// test-only backdoor — after seeding or mutating the task the event names.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface ProvisionedUser {
  userId: string
  token: string
}

describe('task board: the scope-filtered live channel (#132, Slice A2)', () => {
  let harness: TestHarness
  let baseUrl: string
  const openClients: SseClient[] = []

  let locationAId: string
  let locationBId: string
  let admin: string
  let managerA: ProvisionedUser
  let empA1: ProvisionedUser
  let empA2: ProvisionedUser
  let empB1: ProvisionedUser
  let taskA1Id: string

  beforeAll(async () => {
    harness = await createTestHarness()
    // A real socket — the scoped-read suite drives app.inject(), but an SSE stream needs an actual
    // server to connect an EventSource-style reader to.
    baseUrl = await harness.listen()
  })

  afterAll(async () => {
    await harness?.close()
  })

  // Close every stream a case opened so app.close() in afterAll never waits on a live connection,
  // and so one case's subscribers cannot receive another's publishes.
  afterEach(() => {
    for (const client of openClients.splice(0)) client.close()
  })

  const adminToken = async (): Promise<string> => {
    const login = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: SEED_EMAIL, password: SEED_PASSWORD },
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
    role: 'manager' | 'employee',
    locationId: string,
  ): Promise<ProvisionedUser> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName, role, locationId },
    })
    expect(invited.statusCode).toBe(201)
    const userId = invited.json<{ id: string }>().id
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return { userId, token: accepted.json<{ token: string }>().token }
  }

  // Open a stream for a token, register it for teardown, and wait until it is subscribed (the route
  // writes `: connected` the moment it joins the bus, so a resolved `opened` means later publishes
  // will reach it). access_token in the query is the transport auth the browser's EventSource needs.
  const subscribe = async (token: string): Promise<SseClient> => {
    const client = openSse(`${baseUrl}/tasks/stream?access_token=${token}`)
    openClients.push(client)
    await client.opened
    return client
  }

  // Assert a client saw an upsert for a task within the timeout; return nothing (throws on miss).
  const expectDelivered = async (client: SseClient, taskId: string): Promise<void> => {
    await expect(client.waitFor((e) => e.task.id === taskId)).resolves.toBeDefined()
  }

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    admin = await adminToken()

    locationAId = (await harness.seedLocation({ name: 'Downtown' })).id
    locationBId = (await harness.seedLocation({ name: 'Harbour' })).id

    managerA = await provision('mgr-a@burgers.local', 'Manager A', 'manager', locationAId)
    empA1 = await provision('emp-a1@burgers.local', 'Emp A1', 'employee', locationAId)
    empA2 = await provision('emp-a2@burgers.local', 'Emp A2', 'employee', locationAId)
    empB1 = await provision('emp-b1@burgers.local', 'Emp B1', 'employee', locationBId)

    // One location-A task assigned to empA1 — the subject of the fan-out cases.
    taskA1Id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Prep the grill',
        priority: 'high',
        position: 10,
        assigneeIds: [empA1.userId],
      })
    ).id
  })

  it('delivers a change to the assignee, their manager, and the admin — and withholds it from a co-worker and another location', async () => {
    const [assignee, manager, chain, coworker, otherLocation] = await Promise.all([
      subscribe(empA1.token),
      subscribe(managerA.token),
      subscribe(admin),
      subscribe(empA2.token),
      subscribe(empB1.token),
    ])

    harness.taskBoard.events.publish({ taskId: taskA1Id })

    // In scope: the assignee, the location's manager, and the chain-wide admin all receive it.
    await expectDelivered(assignee, taskA1Id)
    await expectDelivered(manager, taskA1Id)
    await expectDelivered(chain, taskA1Id)

    // Out of scope: a same-location co-worker the task is not assigned to, and an employee at
    // another location, are never told the task exists. The positive deliveries above prove the
    // publish propagated, so a grace window here is enough to prove these two got nothing.
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(coworker.received).toHaveLength(0)
    expect(otherLocation.received).toHaveLength(0)
  })

  it('delivers the full task as the subscriber is allowed to see it', async () => {
    const assignee = await subscribe(empA1.token)
    harness.taskBoard.events.publish({ taskId: taskA1Id })

    const event = await assignee.waitFor((e) => e.task.id === taskA1Id)
    expect(event.type).toBe('task.upserted')
    expect(event.task).toMatchObject({
      id: taskA1Id,
      title: 'Prep the grill',
      priority: 'high',
      locationId: locationAId,
    })
    expect(event.task.assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt: expect.any(String) },
    ])
  })

  it('honours a reassignment at delivery time: toward an employee it appears, away from them it is withheld', async () => {
    const a1 = await subscribe(empA1.token)
    const a2 = await subscribe(empA2.token)

    // Move the task off empA1 and onto empA2 (the reassignment the write slices will own), then
    // announce the change. Scope is read fresh at delivery, so the boundary moves with the data.
    await harness.setTaskAssignees(taskA1Id, [empA2.userId])
    harness.taskBoard.events.publish({ taskId: taskA1Id })

    // Toward empA2: delivered. empA1, no longer assigned, is not told it moved away.
    await expectDelivered(a2, taskA1Id)
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(a1.received).toHaveLength(0)
  })

  it('resumes live updates on a fresh connection after a drop, and the plain REST read works with no channel open', async () => {
    // The board still reads over plain REST with no stream open at all (the channel-down fallback).
    const board = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${empA1.token}` },
    })
    expect(board.statusCode).toBe(200)

    // A first connection receives a change, then drops.
    const first = await subscribe(empA1.token)
    harness.taskBoard.events.publish({ taskId: taskA1Id })
    await expectDelivered(first, taskA1Id)
    first.close()

    // A brand-new connection (what native SSE reconnect opens) resumes live updates — the server
    // holds no per-connection state that a reconnect must restore.
    const reconnected = await subscribe(empA1.token)
    harness.taskBoard.events.publish({ taskId: taskA1Id })
    await expectDelivered(reconnected, taskA1Id)
  })

  it('is server→client only — the channel accepts no write verb', async () => {
    // Only GET is registered at /tasks/stream; a POST (any write) finds no route. Nothing is
    // writable over the live channel — every write travels the guarded REST endpoints instead.
    const posted = await harness.app.inject({
      method: 'POST',
      url: '/tasks/stream',
      headers: { authorization: `Bearer ${empA1.token}` },
    })
    expect(posted.statusCode).toBe(404)
  })

  it('refuses to open the channel without a session', async () => {
    // No header and no access_token query: one generic 401, the same wall the REST board read hits.
    const noToken = await harness.app.inject({ method: 'GET', url: '/tasks/stream' })
    expect(noToken.statusCode).toBe(401)
    // A garbage token is likewise refused before any stream opens.
    const badToken = await harness.app.inject({
      method: 'GET',
      url: '/tasks/stream?access_token=not-a-real-token',
    })
    expect(badToken.statusCode).toBe(401)
  })
})
