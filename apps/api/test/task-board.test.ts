import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Task board Slice A — the scoped read (#131). These cases prove the ADR-0007 scope predicate end
// to end through real HTTP: an employee reads only their own assigned tasks (backlog and other
// people's work structurally excluded), a manager reads their whole location including the backlog
// but never another location's, and an admin reads the chain including every backlog. They also
// prove every field renders (description in its authored language, untranslated), the board opens
// to the shared position order (not the priority sort, which is a client-side lens), and opening
// the board bumps the per-user last-seen marker — observed through a follow-up read, never a row
// peek. Users are provisioned through the real invite/accept flow; tasks are seeded directly
// because no create path exists until Slice B.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

// A Hebrew description, seeded verbatim to prove the board renders a task's text in the language it
// was authored in and never auto-translates it (story 10).
const HEBREW_DESCRIPTION = 'לסדר את המקרר לפני הפתיחה'
const DUE_DATE = new Date('2026-02-01T09:00:00.000Z')
const COMPLETED_AT = new Date('2026-01-05T12:00:00.000Z')

interface ProvisionedUser {
  userId: string
  token: string
}

describe('task board: the scoped read (#131, Slice A)', () => {
  let harness: TestHarness

  // The seeded board, rebuilt fresh before each case (reset() truncates between tests). Location A
  // holds two assigned tasks and a backlog task; location B holds one, so cross-location exclusion
  // has something real to exclude.
  let locationAId: string
  let locationBId: string
  let admin: string
  let managerA: ProvisionedUser
  let empA1: ProvisionedUser
  let empA2: ProvisionedUser
  let empB1: ProvisionedUser
  // taskA1: fully-populated, high priority, position 30, assigned to empA1.
  // taskA2: done with a completed_at, normal priority, position 20, assigned to empA2.
  // backlogA: unassigned (the backlog), low priority, position 10.
  // taskB1: location B, assigned to empB1.
  let taskA1Id: string
  let taskA2Id: string
  let backlogAId: string
  let taskB1Id: string

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  // --- helpers, driving the HTTP seam ---

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
    expect(mail).toBeDefined()
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    return (match as RegExpExecArray)[1]
  }

  // Provision a user through the real invite/accept flow and return their id and a live session.
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
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'he' },
    })
    expect(accepted.statusCode).toBe(200)
    return { userId, token: accepted.json<{ token: string }>().token }
  }

  const getBoard = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })

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
    createdAt: string
    updatedAt: string
  }

  const boardOf = (response: LightMyRequestResponse) =>
    response.json<{ tasks: BoardTask[]; lastSeenAt: string | null }>()

  const idsOf = (response: LightMyRequestResponse): string[] =>
    boardOf(response).tasks.map((task) => task.id)

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    admin = await adminToken()

    const locationA = await harness.seedLocation({ name: 'Downtown' })
    const locationB = await harness.seedLocation({ name: 'Harbour' })
    locationAId = locationA.id
    locationBId = locationB.id

    managerA = await provision('mgr-a@burgers.local', 'Manager A', 'manager', locationAId)
    empA1 = await provision('emp-a1@burgers.local', 'Emp A1', 'employee', locationAId)
    empA2 = await provision('emp-a2@burgers.local', 'Emp A2', 'employee', locationAId)
    empB1 = await provision('emp-b1@burgers.local', 'Emp B1', 'employee', locationBId)

    // Positions run counter to priority on purpose: position order is [backlogA(10), taskA2(20),
    // taskA1(30)] while priority high→low would be [taskA1, taskA2, backlogA] — the exact reverse.
    // A read that comes back in position order therefore proves the board opens to the manual
    // order and does not silently apply the priority sort (that lens is client-side).
    taskA1Id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Prep the grill',
        description: HEBREW_DESCRIPTION,
        status: 'in_progress',
        priority: 'high',
        dueDate: DUE_DATE,
        position: 30,
        assigneeIds: [empA1.userId],
      })
    ).id
    taskA2Id = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Close the register',
        status: 'done',
        priority: 'normal',
        completedAt: COMPLETED_AT,
        position: 20,
        assigneeIds: [empA2.userId],
      })
    ).id
    backlogAId = (
      await harness.seedTask({
        locationId: locationAId,
        title: 'Restock napkins',
        priority: 'low',
        position: 10,
        assigneeIds: [],
      })
    ).id
    taskB1Id = (
      await harness.seedTask({
        locationId: locationBId,
        title: 'Sweep the patio',
        priority: 'high',
        position: 10,
        assigneeIds: [empB1.userId],
      })
    ).id
  })

  it('gives an employee only their own assigned tasks — backlog and other people are excluded', async () => {
    const board = await getBoard(empA1.token)
    expect(board.statusCode).toBe(200)
    // Exactly the one task assigned to empA1 — not empA2's task, not the backlog, not location B's.
    expect(idsOf(board)).toEqual([taskA1Id])
    const seen = idsOf(board)
    expect(seen).not.toContain(taskA2Id)
    expect(seen).not.toContain(backlogAId)
    expect(seen).not.toContain(taskB1Id)
  })

  it('never leaks another location to an employee — empB1 sees only their own task', async () => {
    const board = await getBoard(empB1.token)
    expect(board.statusCode).toBe(200)
    expect(idsOf(board)).toEqual([taskB1Id])
  })

  it("gives a manager their whole location including the backlog, never another location's", async () => {
    const board = await getBoard(managerA.token)
    expect(board.statusCode).toBe(200)
    const seen = idsOf(board)
    // All of location A, backlog included...
    expect(seen).toContain(taskA1Id)
    expect(seen).toContain(taskA2Id)
    expect(seen).toContain(backlogAId)
    // ...and nothing from location B.
    expect(seen).not.toContain(taskB1Id)
    expect(seen).toHaveLength(3)
  })

  it('gives an admin every location including every backlog, chain-wide', async () => {
    const board = await getBoard(admin)
    expect(board.statusCode).toBe(200)
    const seen = idsOf(board)
    expect(seen).toEqual(expect.arrayContaining([taskA1Id, taskA2Id, backlogAId, taskB1Id]))
    expect(seen).toHaveLength(4)
  })

  it('renders every field of a task, with the description in its authored language', async () => {
    // empA1's single task is the fully-populated one; read it back through the employee's own board.
    const task = boardOf(await getBoard(empA1.token)).tasks[0]
    expect(task).toMatchObject({
      id: taskA1Id,
      locationId: locationAId,
      title: 'Prep the grill',
      // The Hebrew description comes back byte-for-byte — shown as authored, never translated.
      description: HEBREW_DESCRIPTION,
      status: 'in_progress',
      priority: 'high',
      dueDate: DUE_DATE.toISOString(),
      // Not done, so no completed_at.
      completedAt: null,
      position: 30,
    })
    expect(task.assignees).toEqual([{ id: empA1.userId, displayName: 'Emp A1' }])
  })

  it('surfaces the system-maintained completed_at on a done task', async () => {
    const task = boardOf(await getBoard(managerA.token)).tasks.find((t) => t.id === taskA2Id)
    expect(task).toBeDefined()
    expect(task?.status).toBe('done')
    expect(task?.completedAt).toBe(COMPLETED_AT.toISOString())
  })

  it('opens to the shared position order, not the priority sort', async () => {
    // Position order is the reverse of priority high→low here, so this order proves the board
    // returns the manual arrangement and leaves the priority sort to the client.
    const board = await getBoard(managerA.token)
    expect(idsOf(board)).toEqual([backlogAId, taskA2Id, taskA1Id])
  })

  it('bumps the per-user last-seen marker on open, observable through a follow-up read', async () => {
    // First open: the marker has never been set, so it reports null — and, as a side effect, is
    // advanced to "now" (the clock's start).
    const first = await getBoard(empA1.token)
    expect(first.statusCode).toBe(200)
    expect(boardOf(first).lastSeenAt).toBeNull()
    const firstOpenedAt = harness.clock.now().toISOString()

    // Time passes, then the board is opened again. The marker now reports where the *first* open
    // left it — proof the open bumped it, seen through behaviour rather than a row peek.
    harness.clock.advance(60 * 60 * 1000)
    const second = await getBoard(empA1.token)
    expect(boardOf(second).lastSeenAt).toBe(firstOpenedAt)
  })

  it('keeps each user last-seen marker independent', async () => {
    // empA1 opens the board; empA2 has never opened it, so empA2's own follow-up still reports null.
    await getBoard(empA1.token)
    harness.clock.advance(60 * 60 * 1000)
    const empA2First = await getBoard(empA2.token)
    expect(boardOf(empA2First).lastSeenAt).toBeNull()
  })

  it('refuses the board read without a bearer', async () => {
    const board = await harness.app.inject({ method: 'GET', url: '/tasks' })
    expect(board.statusCode).toBe(401)
  })
})
