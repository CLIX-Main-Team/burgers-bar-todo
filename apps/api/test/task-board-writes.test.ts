import type { LightMyRequestResponse } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type SseClient, openSse } from './helpers/sse-client.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Task board Slice B — the manager/admin write surface (#133; ADR-0007, ADR-0015). This is the
// rule-5 write slice: it proves, end to end through real HTTP, the two-tier permission model on
// every write. Tier one (the role guard) refuses an employee every write; tier two (the scope
// predicate reused from Slice A) confines a manager to their own location and lets an admin write
// chain-wide. On top sits the assignee-location invariant — every assignee must belong to the task's
// own location, checked before the write — and the backlog-is-the-empty-set rule. Every case asserts
// external behaviour only: a status and body, and state read back through a follow-up board read or a
// delivered live event, never a row at rest.

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

describe('task board: the manager/admin write surface (#133, Slice B)', () => {
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

  // Close any SSE stream a case opened, so app.close() never waits on a live connection and one
  // case's subscribers never receive another's publishes.
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

  const createTask = (token: string, body: unknown): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
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

  const deleteTask = (token: string, taskId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/delete`,
      headers: { authorization: `Bearer ${token}` },
    })

  const boardIds = async (token: string): Promise<string[]> => {
    const board = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(board.statusCode).toBe(200)
    return board.json<{ tasks: BoardTask[] }>().tasks.map((task) => task.id)
  }

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

  // --- create: scope, assignment, and the backlog ---

  it('lets a manager create and assign a task on their own location', async () => {
    const created = await createTask(managerA.token, {
      title: 'Prep the grill',
      description: 'Before open',
      priority: 'high',
      dueDate: new Date('2026-03-01T00:00:00.000Z').toISOString(),
      assigneeIds: [empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    const task = created.json<BoardTask>()
    expect(task).toMatchObject({
      locationId: locationAId,
      title: 'Prep the grill',
      description: 'Before open',
      status: 'not_started',
      priority: 'high',
      dueDate: '2026-03-01T00:00:00.000Z',
    })
    expect(task.assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt: expect.any(String) },
    ])
    // The creator is the acting principal, denormalized with their rendered name (#258).
    expect(task.createdBy).toEqual({ id: managerA.userId, displayName: 'Manager A' })

    // The assignee reads it on their own scoped board — the write reached the exact person named.
    expect(await boardIds(empA1.token)).toContain(task.id)
  })

  it('records the creator from the session, never the body, and every reader sees it (#258)', async () => {
    // A body that tries to name someone else as creator: the create schema carries no such field,
    // so it is stripped and the acting principal is recorded regardless — authorship is as
    // unforgeable as the location resolution.
    const created = await createTask(managerA.token, {
      title: 'Count the float',
      assigneeIds: [empA1.userId],
      createdBy: empA2.userId,
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<BoardTask>().createdBy).toEqual({
      id: managerA.userId,
      displayName: 'Manager A',
    })

    // The assignee's own scoped board read carries the creator's name — the detail surface renders
    // "Created by" for every role that can see the task.
    const seen = await boardTask(empA1.token, created.json<BoardTask>().id)
    expect(seen?.createdBy).toEqual({ id: managerA.userId, displayName: 'Manager A' })
  })

  it('lands a task with no assignees in the backlog — visible to the manager, invisible to employees', async () => {
    const created = await createTask(managerA.token, { title: 'Restock napkins', priority: 'low' })
    expect(created.statusCode).toBe(201)
    const task = created.json<BoardTask>()
    expect(task.assignees).toEqual([])

    // The manager sees the whole location including the backlog; an employee's assignee-scoped board
    // structurally excludes an unassigned task.
    expect(await boardIds(managerA.token)).toContain(task.id)
    expect(await boardIds(empA1.token)).not.toContain(task.id)
  })

  it('lets an admin create on any location', async () => {
    const created = await createTask(admin, {
      title: 'Sweep the patio',
      locationId: locationBId,
      assigneeIds: [empB1.userId],
    })
    expect(created.statusCode).toBe(201)
    const task = created.json<BoardTask>()
    expect(task.locationId).toBe(locationBId)
    expect(await boardIds(empB1.token)).toContain(task.id)
  })

  it("refuses a manager creating on another location's board", async () => {
    const created = await createTask(managerA.token, {
      title: 'Not my board',
      locationId: locationBId,
    })
    expect(created.statusCode).toBe(403)
    // Nothing landed on location B — a rejected create writes no task.
    expect(await boardIds(empB1.token)).toHaveLength(0)
  })

  it('refuses an admin creating with no location named', async () => {
    // An admin holds no location of their own, so a create must name one; naming none is invalid.
    const created = await createTask(admin, { title: 'Where does this go?' })
    expect(created.statusCode).toBe(400)
  })

  it('rejects a cross-location assignee on create — the assignee-location invariant, before the write', async () => {
    // empB1 belongs to location B; assigning them to a location-A task is refused, and no task lands.
    const created = await createTask(managerA.token, {
      title: 'Cross-location assign',
      assigneeIds: [empB1.userId],
    })
    expect(created.statusCode).toBe(400)
    expect(await boardIds(managerA.token)).toHaveLength(0)
  })

  it('tolerates a repeated assignee id, assigning the person once', async () => {
    // A body naming the same user twice must resolve to a single membership, not trip the
    // (task_id, user_id) composite key with a 500.
    const created = await createTask(managerA.token, {
      title: 'Deduped assignees',
      assigneeIds: [empA1.userId, empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<BoardTask>().assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt: expect.any(String) },
    ])
  })

  // --- edit: scope, reassignment, and the invariant ---

  it("lets a manager edit their task's fields, observed through a follow-up read", async () => {
    const created = await createTask(managerA.token, { title: 'Draft', priority: 'low' })
    const id = created.json<BoardTask>().id

    const edited = await updateTask(managerA.token, id, {
      title: 'Prep the grill',
      description: 'Now with detail',
      priority: 'high',
      dueDate: new Date('2026-04-01T00:00:00.000Z').toISOString(),
      assigneeIds: [empA1.userId],
    })
    expect(edited.statusCode).toBe(200)

    const seen = await boardTask(managerA.token, id)
    expect(seen).toMatchObject({
      title: 'Prep the grill',
      description: 'Now with detail',
      priority: 'high',
      dueDate: '2026-04-01T00:00:00.000Z',
    })
    expect(seen?.assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt: expect.any(String) },
    ])
  })

  it('reassigns a task between employees — it appears for the new assignee and leaves the old one', async () => {
    const created = await createTask(managerA.token, {
      title: 'Moves around',
      assigneeIds: [empA1.userId],
    })
    const id = created.json<BoardTask>().id
    expect(await boardIds(empA1.token)).toContain(id)

    const edited = await updateTask(managerA.token, id, {
      title: 'Moves around',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empA2.userId],
    })
    expect(edited.statusCode).toBe(200)

    // Toward empA2 it now appears; away from empA1 it is gone — the same assignee-scoped boundary the
    // read draws, honoured after a reassignment.
    expect(await boardIds(empA2.token)).toContain(id)
    expect(await boardIds(empA1.token)).not.toContain(id)
  })

  it('empties the assignee set on edit, moving a task to the backlog', async () => {
    const created = await createTask(managerA.token, {
      title: 'Send to backlog',
      assigneeIds: [empA1.userId],
    })
    const id = created.json<BoardTask>().id

    const edited = await updateTask(managerA.token, id, {
      title: 'Send to backlog',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [],
    })
    expect(edited.statusCode).toBe(200)
    // Now unassigned: the manager still sees it, the former assignee no longer does.
    expect(await boardIds(managerA.token)).toContain(id)
    expect(await boardIds(empA1.token)).not.toContain(id)
  })

  it("preserves an unchanged assignee's assignedAt across an edit (#136)", async () => {
    // The badge dates new assignments from the assignee row's created_at, so an edit that keeps an
    // assignee must keep their date too — reconciliation by difference, not delete-and-reinsert —
    // or every title fix would spuriously re-notify people already on the task.
    const created = await createTask(managerA.token, {
      title: 'Original title',
      assigneeIds: [empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    const id = created.json<BoardTask>().id
    const assignedAt = created.json<BoardTask>().assignees[0].assignedAt

    const edited = await updateTask(managerA.token, id, {
      title: 'Renamed title',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [empA1.userId],
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json<BoardTask>().assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt },
    ])
  })

  it("refuses a manager editing another location's task with a non-enumerating 404", async () => {
    const created = await createTask(admin, { title: 'Location B task', locationId: locationBId })
    const id = created.json<BoardTask>().id

    const edited = await updateTask(managerA.token, id, {
      title: 'Hijacked',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [],
    })
    expect(edited.statusCode).toBe(404)
    // The task is untouched on location B — the out-of-scope edit changed nothing.
    expect((await boardTask(admin, id))?.title).toBe('Location B task')
  })

  it('rejects a cross-location assignee on edit — the invariant re-checked against the task location', async () => {
    const created = await createTask(managerA.token, {
      title: 'Stays put',
      assigneeIds: [empA1.userId],
    })
    const id = created.json<BoardTask>().id

    const edited = await updateTask(managerA.token, id, {
      title: 'Stays put',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empB1.userId],
    })
    expect(edited.statusCode).toBe(400)
    // The original assignee still holds it — the rejected edit did not rewrite the set.
    expect((await boardTask(managerA.token, id))?.assignees).toEqual([
      { id: empA1.userId, displayName: 'Emp A1', assignedAt: expect.any(String) },
    ])
  })

  // --- delete: scope ---

  it('lets a manager delete their own task; it leaves every board', async () => {
    const created = await createTask(managerA.token, {
      title: 'Delete me',
      assigneeIds: [empA1.userId],
    })
    const id = created.json<BoardTask>().id
    expect(await boardIds(empA1.token)).toContain(id)

    const deleted = await deleteTask(managerA.token, id)
    expect(deleted.statusCode).toBe(200)
    expect(await boardIds(managerA.token)).not.toContain(id)
    expect(await boardIds(empA1.token)).not.toContain(id)
  })

  it("refuses a manager deleting another location's task, and removes nothing", async () => {
    const created = await createTask(admin, { title: 'Location B task', locationId: locationBId })
    const id = created.json<BoardTask>().id

    const deleted = await deleteTask(managerA.token, id)
    expect(deleted.statusCode).toBe(404)
    // Still there on B's board — the out-of-scope delete was a no-op.
    expect(await boardTask(admin, id)).toBeDefined()
  })

  // --- the employee wall (tier one) ---

  it('refuses an employee every write at the role guard', async () => {
    // A real task the manager owns, so the refusals are about the actor's role, not a missing task.
    const created = await createTask(managerA.token, {
      title: 'Employee cannot touch',
      assigneeIds: [empA1.userId],
    })
    const id = created.json<BoardTask>().id

    expect((await createTask(empA1.token, { title: 'Nope' })).statusCode).toBe(403)
    expect(
      (
        await updateTask(empA1.token, id, {
          title: 'Nope',
          description: null,
          priority: 'high',
          dueDate: null,
          assigneeIds: [empA1.userId],
        })
      ).statusCode,
    ).toBe(403)
    expect((await deleteTask(empA1.token, id)).statusCode).toBe(403)

    // And the task the employee could not write is unchanged.
    expect((await boardTask(managerA.token, id))?.title).toBe('Employee cannot touch')
  })

  it('refuses a write with no bearer', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/tasks',
      payload: { title: 'Anonymous' },
    })
    expect(created.statusCode).toBe(401)
  })

  // --- the live channel: writes emit the events A2 relays ---

  it('emits a change on create and on edit that the live channel relays to an in-scope subscriber', async () => {
    const baseUrl = await harness.listen()
    // The chain-wide admin subscribes; every location-A change is in their scope. access_token in the
    // query is the transport auth the EventSource-style reader needs.
    const stream = openSse(`${baseUrl}/tasks/stream?access_token=${admin}`)
    openClients.push(stream)
    await stream.opened

    // A create over REST is announced on the bus and relayed live to the subscriber.
    const created = await createTask(managerA.token, {
      title: 'Live create',
      assigneeIds: [empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    const id = created.json<BoardTask>().id
    const createEvent = await stream.waitFor((event) => event.task.id === id)
    expect(createEvent.type).toBe('task.upserted')
    expect(createEvent.task.title).toBe('Live create')

    // An edit is likewise announced and relayed — the changed task, as the subscriber may see it.
    const edited = await updateTask(managerA.token, id, {
      title: 'Live edit',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [empA1.userId],
    })
    expect(edited.statusCode).toBe(200)
    const editEvent = await stream.waitFor((event) => event.task.title === 'Live edit')
    expect(editEvent.task.id).toBe(id)
  })
})
