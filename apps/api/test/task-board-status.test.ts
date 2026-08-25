import type { LightMyRequestResponse } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type SseClient, openSse } from './helpers/sse-client.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Task board Slice C — the status write path (#134; ADR-0002 in its ADR-0007 form, ADR-0015). This
// is the second rule-5 write slice. It proves, end to end through real HTTP, the employee status-only
// rule as a *dedicated write path*: an assignee may move a task's status any→any but touches nothing
// else, and is refused a status change on a task not assigned to them. The path carries no tier-one
// role guard — an employee reaches it, uniquely — so authorisation is the scope predicate alone: an
// employee is confined to their own assigned tasks, a manager to their location, an admin chain-wide
// (the same predicate that gates every read). completed_at is maintained by the DB trigger, not any
// write path. Managers/admins may also set status through the Slice B full-update path. Every case
// asserts external behaviour only — a status and body, and state read back through a follow-up board
// read or a delivered live event — never a row at rest.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface ProvisionedUser {
  userId: string
  token: string
}

interface BoardTask {
  id: string
  locationId: string
  title: string
  description: string | null
  status: string
  priority: string
  dueDate: string | null
  completedAt: string | null
  position: number
  assignees: { id: string; displayName: string }[]
}

describe('task board: the status write path (#134, Slice C)', () => {
  let harness: TestHarness
  const openClients: SseClient[] = []

  let locationAId: string
  let locationBId: string
  let admin: string
  let managerA: ProvisionedUser
  let empA1: ProvisionedUser
  let empA2: ProvisionedUser
  let empB1: ProvisionedUser

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

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

  // --- write helpers, driving the real HTTP endpoints ---

  const setStatus = (
    token: string,
    taskId: string,
    status: string,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status },
    })

  const updateTask = (
    token: string,
    taskId: string,
    body: unknown,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/update`,
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    })

  const boardTask = async (token: string, taskId: string): Promise<BoardTask | undefined> => {
    const board = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(board.statusCode).toBe(200)
    return board.json<{ tasks: BoardTask[] }>().tasks.find((task) => task.id === taskId)
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
  })

  // --- the employee status-only path: any -> any on an own task ---

  it('lets an employee flip an assigned task any -> any, observed through a follow-up read', async () => {
    const id = (await harness.seedTask({ locationId: locationAId, assigneeIds: [empA1.userId] })).id
    // A freshly-seeded task starts not_started.
    expect((await boardTask(empA1.token, id))?.status).toBe('not_started')

    // not_started -> in_progress -> done -> back to not_started: every direction is allowed, nothing
    // is workflow-gated, and each move is observed on the assignee's own scoped board.
    for (const status of ['in_progress', 'done', 'not_started', 'done'] as const) {
      const res = await setStatus(empA1.token, id, status)
      expect(res.statusCode).toBe(200)
      expect(res.json<BoardTask>().status).toBe(status)
      expect((await boardTask(empA1.token, id))?.status).toBe(status)
    }
  })

  it('refuses an employee a status change on a task not assigned to them, and changes nothing', async () => {
    // Assigned to empA2, not empA1 — empA1 must not be able to move it.
    const id = (await harness.seedTask({ locationId: locationAId, assigneeIds: [empA2.userId] })).id

    const res = await setStatus(empA1.token, id, 'done')
    // A task outside the caller's scope is one non-enumerating 404 — it never confirms the task exists.
    expect(res.statusCode).toBe(404)
    // The status is untouched, seen through the assignee who may read it.
    expect((await boardTask(empA2.token, id))?.status).toBe('not_started')
  })

  it("refuses an employee any status change on a task on another location's board", async () => {
    const id = (await harness.seedTask({ locationId: locationBId, assigneeIds: [empB1.userId] })).id
    // empA1 (location A) cannot even name a location-B task — the scope predicate hides it.
    expect((await setStatus(empA1.token, id, 'done')).statusCode).toBe(404)
    expect((await boardTask(empB1.token, id))?.status).toBe('not_started')
  })

  it('touches only the status column — every other field is unchanged', async () => {
    // A fully-populated task assigned to empA1: after a status flip, only status (and its
    // trigger-maintained completed_at) may differ — title, description, priority, due date, and the
    // assignee set must survive byte-for-byte.
    const dueDate = new Date('2026-05-01T00:00:00.000Z')
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Prep the grill',
        description: 'Before open',
        priority: 'high',
        dueDate,
        assigneeIds: [empA1.userId, empA2.userId],
      })
    ).id

    const before = await boardTask(managerA.token, id)
    expect((await setStatus(empA1.token, id, 'in_progress')).statusCode).toBe(200)
    const after = await boardTask(managerA.token, id)

    expect(after).toMatchObject({
      title: 'Prep the grill',
      description: 'Before open',
      priority: 'high',
      dueDate: dueDate.toISOString(),
      position: before?.position,
    })
    expect(after?.status).toBe('in_progress')
    expect(after?.assignees).toEqual(before?.assignees)
  })

  // --- the completed_at trigger: set on entering done, cleared on leaving ---

  it('sets completed_at when a task enters done and clears it when it leaves, via the DB trigger', async () => {
    const id = (await harness.seedTask({ locationId: locationAId, assigneeIds: [empA1.userId] })).id
    // Starts not_started with no completion stamp.
    expect((await boardTask(empA1.token, id))?.completedAt).toBeNull()

    // Entering done fills completed_at automatically — no write path typed it.
    expect((await setStatus(empA1.token, id, 'done')).statusCode).toBe(200)
    const done = await boardTask(empA1.token, id)
    expect(done?.status).toBe('done')
    expect(done?.completedAt).not.toBeNull()

    // Leaving done clears it — a reopened task is not left falsely marked complete.
    expect((await setStatus(empA1.token, id, 'in_progress')).statusCode).toBe(200)
    const reopened = await boardTask(empA1.token, id)
    expect(reopened?.status).toBe('in_progress')
    expect(reopened?.completedAt).toBeNull()
  })

  // --- one shared status, no per-person completion ---

  it('reflects the one shared status to every assignee — there is no per-person done', async () => {
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        assigneeIds: [empA1.userId, empA2.userId],
      })
    ).id

    // empA1 marks it done; empA2 — a co-assignee on the same task — sees the very same done status.
    expect((await setStatus(empA1.token, id, 'done')).statusCode).toBe(200)
    expect((await boardTask(empA2.token, id))?.status).toBe('done')
  })

  // --- the manager/admin path: status through the full edit (story 43) ---

  it('lets a manager set status through the full-update path', async () => {
    // Attributed to the manager: since 2026-08-25 the full edit belongs to whoever wrote the task,
    // and a manager reaches somebody else's shared work only through the status-only path.
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: managerA.userId,
        title: 'Manager moves this',
        assigneeIds: [empA1.userId],
      })
    ).id

    const res = await updateTask(managerA.token, id, {
      title: 'Manager moves this',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empA1.userId],
      status: 'done',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<BoardTask>().status).toBe('done')
    // And the trigger fired on the full-update path too — completed_at is filled.
    const seen = await boardTask(managerA.token, id)
    expect(seen?.status).toBe('done')
    expect(seen?.completedAt).not.toBeNull()
  })

  it('lets an admin set status on any location through the full-update path', async () => {
    const id = (
      await harness.seedTask({
        locationId: locationBId,
        title: 'Cross-chain status',
        assigneeIds: [empB1.userId],
      })
    ).id

    const res = await updateTask(admin, id, {
      title: 'Cross-chain status',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empB1.userId],
      status: 'in_progress',
    })
    expect(res.statusCode).toBe(200)
    expect((await boardTask(empB1.token, id))?.status).toBe('in_progress')
  })

  it('leaves status untouched on a full-update that omits it', async () => {
    // The full-update path may set status but need not: a Slice-B-shaped edit with no status field
    // moves the other fields and leaves the status (and its completed_at) exactly as they were.
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: managerA.userId,
        status: 'done',
        assigneeIds: [empA1.userId],
      })
    ).id
    const before = await boardTask(managerA.token, id)
    expect(before?.status).toBe('done')

    const res = await updateTask(managerA.token, id, {
      title: 'Edited, status left alone',
      description: null,
      priority: 'medium',
      dueDate: null,
      assigneeIds: [empA1.userId],
    })
    expect(res.statusCode).toBe(200)
    const after = await boardTask(managerA.token, id)
    expect(after?.title).toBe('Edited, status left alone')
    expect(after?.status).toBe('done')
    // completed_at survived an edit that did not touch status.
    expect(after?.completedAt).toBe(before?.completedAt)
  })

  // --- refusals at the edges ---

  it('refuses a status write with no bearer', async () => {
    const id = (await harness.seedTask({ locationId: locationAId, assigneeIds: [empA1.userId] })).id
    const res = await harness.app.inject({
      method: 'POST',
      url: `/tasks/${id}/status`,
      payload: { status: 'done' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a status value outside the enum', async () => {
    const id = (await harness.seedTask({ locationId: locationAId, assigneeIds: [empA1.userId] })).id
    expect((await setStatus(empA1.token, id, 'archived')).statusCode).toBe(400)
  })

  // --- the live channel: a status change reaches an in-scope subscriber ---

  it("emits a change on a status flip that the live channel relays to a manager's board", async () => {
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Watched task',
        assigneeIds: [empA1.userId],
      })
    ).id

    const baseUrl = await harness.listen()
    // The location-A manager subscribes; the employee's status change is in their scope.
    const stream = openSse(`${baseUrl}/tasks/stream?access_token=${managerA.token}`)
    openClients.push(stream)
    await stream.opened

    expect((await setStatus(empA1.token, id, 'done')).statusCode).toBe(200)

    const event = await stream.waitFor((e) => e.task.id === id && e.task.status === 'done')
    expect(event.type).toBe('task.upserted')
    expect(event.task.completedAt).not.toBeNull()
  })
})
