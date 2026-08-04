import type { LightMyRequestResponse } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type SseClient, openSse } from './helpers/sse-client.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Task board Slice D — the manual drag-reorder write path (#135; ADR-0007, ADR-0015). This is the
// last write slice and the last rule-5 one. It proves, end to end through real HTTP, that `position`
// is the single canonical shared per-location order and the only thing a reorder mutates: a
// manager/admin sends a location's task ids in a new order, the server rewrites each task's position
// to its index, and every viewer of that location — manager, admin, or an employee whose assigned
// tasks sit in it — reads that one shared order. Authorisation matches the other writes: a tier-one
// role guard bars an employee entirely, and the tier-two location scope confines a manager to their
// own board (naming another is forbidden) while an admin may arrange any (but must name it). A reorder
// announces its changed tasks on the bus so the live channel relays the new arrangement at once. Every
// case asserts external behaviour only — a status/body and the order read back through a follow-up
// board read or a delivered live event — never a row at rest. Drag itself (disabled while the priority
// sort is on) is a UI concern proven in the SPA, not here: this seam owns the shared order and its scope.

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
  status: string
  priority: string
  position: number
  assignees: { id: string; displayName: string }[]
}

describe('task board: the reorder write path (#135, Slice D)', () => {
  let harness: TestHarness
  const openClients: SseClient[] = []

  let locationAId: string
  let locationBId: string
  let admin: string
  let managerA: ProvisionedUser
  let managerB: ProvisionedUser
  let empA1: ProvisionedUser
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

  // --- helpers, driving the real HTTP endpoints ---

  const reorder = (
    token: string,
    body: { orderedIds: string[]; locationId?: string | null },
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks/reorder',
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    })

  // The caller's whole scoped board, in the order the API returns it (position, id tiebreak).
  const board = async (token: string): Promise<BoardTask[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ tasks: BoardTask[] }>().tasks
  }

  // The ids of the caller's board in order — the shared arrangement made observable.
  const boardOrder = async (token: string): Promise<string[]> =>
    (await board(token)).map((task) => task.id)

  // Seed three location-A tasks with known ascending positions, returning their ids in that seeded
  // order. The starting order is deterministic so a reorder's effect is unambiguous.
  const seedThreeAtA = async (assigneeIds: string[] = []): Promise<[string, string, string]> => {
    const first = (
      await harness.seedTask({ locationId: locationAId, title: 'First', position: 0, assigneeIds })
    ).id
    const second = (
      await harness.seedTask({ locationId: locationAId, title: 'Second', position: 1, assigneeIds })
    ).id
    const third = (
      await harness.seedTask({ locationId: locationAId, title: 'Third', position: 2, assigneeIds })
    ).id
    return [first, second, third]
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
    managerB = await provision('mgr-b@burgers.local', 'Manager B', 'manager', locationBId)
    empA1 = await provision('emp-a1@burgers.local', 'Emp A1', 'employee', locationAId)
    empB1 = await provision('emp-b1@burgers.local', 'Emp B1', 'employee', locationBId)
  })

  // --- a manager arranges their own board; position is the shared per-location order ---

  it('lets a manager set the shared order, observed through a follow-up board read', async () => {
    const [first, second, third] = await seedThreeAtA()
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])

    // Drag the last to the front: the new shared order is [third, first, second].
    const res = await reorder(managerA.token, { orderedIds: [third, first, second] })
    expect(res.statusCode).toBe(200)
    // The response carries the reordered board in the new order.
    expect(res.json<{ tasks: BoardTask[] }>().tasks.map((task) => task.id)).toEqual([
      third,
      first,
      second,
    ])

    // And a fresh read confirms the arrangement persisted as position (index-based, from zero).
    const after = await board(managerA.token)
    expect(after.map((task) => task.id)).toEqual([third, first, second])
    expect(after.map((task) => task.position)).toEqual([0, 1, 2])
  })

  it('makes the manual order the shared default every viewer of the location sees', async () => {
    // All three assigned to empA1, so the employee's scoped board holds exactly them.
    const [first, second, third] = await seedThreeAtA([empA1.userId])

    expect((await reorder(managerA.token, { orderedIds: [second, third, first] })).statusCode).toBe(
      200,
    )

    // The manager set the order; the employee sees their assigned tasks in that same shared order
    // (story 50) — not a per-viewer arrangement.
    expect(await boardOrder(managerA.token)).toEqual([second, third, first])
    expect(await boardOrder(empA1.token)).toEqual([second, third, first])
  })

  it('omitted locationId defaults a manager to their own location', async () => {
    const [first, second, third] = await seedThreeAtA()
    // No locationId in the body — a manager's own location is resolved server-side.
    const res = await reorder(managerA.token, { orderedIds: [second, first, third] })
    expect(res.statusCode).toBe(200)
    expect(await boardOrder(managerA.token)).toEqual([second, first, third])
  })

  // --- scope: a manager is confined to their own board; an admin may arrange any ---

  it("refuses a manager reordering another location's board", async () => {
    const [first, second, third] = await seedThreeAtA()
    // Manager B names location A explicitly — forbidden, and location A's order is untouched.
    const res = await reorder(managerB.token, {
      orderedIds: [third, second, first],
      locationId: locationAId,
    })
    expect(res.statusCode).toBe(403)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  it('lets an admin reorder any location by naming it', async () => {
    const [first, second, third] = await seedThreeAtA()
    const res = await reorder(admin, {
      orderedIds: [third, second, first],
      locationId: locationAId,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ tasks: BoardTask[] }>().tasks.map((task) => task.id)).toEqual([
      third,
      second,
      first,
    ])
    // The location's manager sees the admin's arrangement.
    expect(await boardOrder(managerA.token)).toEqual([third, second, first])
  })

  it('rejects an admin reorder that names no location', async () => {
    const [first, second, third] = await seedThreeAtA()
    // An admin holds no location of their own, so a reorder with no target is invalid.
    const res = await reorder(admin, { orderedIds: [third, second, first] })
    expect(res.statusCode).toBe(400)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  // --- an employee is barred from the write entirely (tier-one role guard) ---

  it('refuses an employee a reorder, and changes nothing', async () => {
    const [first, second, third] = await seedThreeAtA([empA1.userId])
    const res = await reorder(empA1.token, { orderedIds: [third, second, first] })
    // Barred at the route by the tier-one role guard — the same 403 the other manager/admin writes give.
    expect(res.statusCode).toBe(403)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  it('refuses a reorder with no bearer', async () => {
    const [first, second, third] = await seedThreeAtA()
    const res = await harness.app.inject({
      method: 'POST',
      url: '/tasks/reorder',
      payload: { orderedIds: [third, second, first] },
    })
    expect(res.statusCode).toBe(401)
  })

  // --- the tasks-in-location invariant: a reorder names only that one location's tasks ---

  it('rejects an order that names a task on another location', async () => {
    const [first, second, third] = await seedThreeAtA()
    const other = (await harness.seedTask({ locationId: locationBId, title: 'Elsewhere' })).id

    // Manager A's own location A, but the list smuggles in a location-B id — rejected as invalid,
    // and nothing is reindexed.
    const res = await reorder(managerA.token, { orderedIds: [first, other, second, third] })
    expect(res.statusCode).toBe(400)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  it('rejects an order that names the same task twice', async () => {
    const [first, second, third] = await seedThreeAtA()
    // A duplicate id can never yield a contiguous per-task position, so a malformed order is refused
    // at the seam rather than written as a corrupt arrangement — and nothing is reindexed.
    const res = await reorder(managerA.token, { orderedIds: [first, second, first, third] })
    expect(res.statusCode).toBe(400)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  it('rejects an order naming an unknown task id', async () => {
    const [first, second, third] = await seedThreeAtA()
    const ghost = '00000000-0000-0000-0000-000000000000'
    const res = await reorder(managerA.token, { orderedIds: [first, ghost, second, third] })
    expect(res.statusCode).toBe(400)
    expect(await boardOrder(managerA.token)).toEqual([first, second, third])
  })

  // --- only position moves; nothing else about a task changes ---

  it('touches only order — status, priority, and assignees are unchanged', async () => {
    const id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Keep my fields',
        status: 'in_progress',
        priority: 'high',
        position: 0,
        assigneeIds: [empA1.userId],
      })
    ).id
    const other = (await harness.seedTask({ locationId: locationAId, position: 1 })).id

    expect((await reorder(managerA.token, { orderedIds: [other, id] })).statusCode).toBe(200)

    const moved = (await board(managerA.token)).find((task) => task.id === id)
    expect(moved).toMatchObject({ status: 'in_progress', priority: 'high' })
    expect(moved?.assignees).toEqual([{ id: empA1.userId, displayName: 'Emp A1' }])
    expect(moved?.position).toBe(1)
  })

  // --- the live channel: a reorder relays the new arrangement to an in-scope subscriber ---

  it("emits changes on a reorder that the live channel relays to a manager's board", async () => {
    const [first, second, third] = await seedThreeAtA()

    const baseUrl = await harness.listen()
    const stream = openSse(`${baseUrl}/tasks/stream?access_token=${managerA.token}`)
    openClients.push(stream)
    await stream.opened

    expect((await reorder(managerA.token, { orderedIds: [third, first, second] })).statusCode).toBe(
      200,
    )

    // The task dragged to the front (third) arrives with its new position 0 — the arrangement is
    // relayed, not just announced.
    const event = await stream.waitFor((e) => e.task.id === third && e.task.position === 0)
    expect(event.type).toBe('task.upserted')
  })
})
