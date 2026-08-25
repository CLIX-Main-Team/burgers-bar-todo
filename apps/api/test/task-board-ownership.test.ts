import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The two rules the owner's 2026-08-25 brief added to the board, both of which are about WHOSE
// work a task is rather than which branch it sits on:
//
//   Private tasks — every account keeps a list only they can read. Not a lens over the shared
//     board (which is what the Personal tab used to be, and why a manager still saw every row on
//     it), but a property of the row: the scope predicate filters it out for everyone else, the
//     chain's owner included. It is the one place in the app a super_admin does not see something.
//
//   The manager's remit — a manager runs the shift: they task the people at their branch and take
//     that work back, and they may move anything on their board along. What they do not do is
//     rewrite the branch admin's instructions or task the admin above them.
//
// Every case drives real HTTP and asserts what a caller can observe — a status, a body, a board
// read — never a row at rest.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface ProvisionedUser {
  userId: string
  token: string
}

interface BoardTask {
  id: string
  title: string
  locationId: string | null
  personal: boolean
  assignees: { id: string }[]
}

describe('task board: private work and the manager remit (2026-08-25)', () => {
  let harness: TestHarness
  let locationAId: string
  let owner: string
  let adminA: ProvisionedUser
  let managerA: ProvisionedUser
  let empA1: ProvisionedUser

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
    role: 'admin' | 'manager' | 'employee',
    locationId: string,
  ): Promise<ProvisionedUser> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${owner}` },
      payload: { email, displayName: email, role, locationId },
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

  const createTask = (
    token: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const updateTask = (
    token: string,
    taskId: string,
    body: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/update`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const deleteTask = (token: string, taskId: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/delete`,
      headers: { authorization: `Bearer ${token}` },
    })

  const board = async (token: string): Promise<BoardTask[]> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ tasks: BoardTask[] }>().tasks
  }

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    locationAId = (await harness.seedLocation({ name: 'Downtown' })).id
    adminA = await provision('admin-a@burgers.local', 'admin', locationAId)
    managerA = await provision('mgr-a@burgers.local', 'manager', locationAId)
    empA1 = await provision('emp-a1@burgers.local', 'employee', locationAId)
  })

  // --- private work ---

  it('keeps a private task from every other account, the chain owner included', async () => {
    const created = await createTask(empA1.token, {
      title: 'Renew my food handling licence',
      personal: true,
      assigneeIds: [empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    const id = created.json<BoardTask>().id

    // The writer sees it, and it belongs to no branch.
    const mine = await board(empA1.token)
    expect(mine.map((task) => task.id)).toContain(id)
    expect(mine.find((task) => task.id === id)?.locationId).toBeNull()

    // Nobody above them does — not the manager who runs their shift, not the branch admin who
    // runs the branch, not the owner who can otherwise read the whole chain.
    for (const token of [managerA.token, adminA.token, owner]) {
      expect((await board(token)).map((task) => task.id)).not.toContain(id)
    }
  })

  it('refuses every other account the private task by id, as if it were not there', async () => {
    const id = (
      await harness.seedTask({
        locationId: null,
        personal: true,
        createdBy: empA1.userId,
        title: 'Mine alone',
        assigneeIds: [empA1.userId],
      })
    ).id

    for (const token of [managerA.token, adminA.token, owner]) {
      const status = await harness.app.inject({
        method: 'POST',
        url: `/tasks/${id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'done' },
      })
      expect(status.statusCode).toBe(404)
      expect((await deleteTask(token, id)).statusCode).toBe(404)
    }

    // And it is still there, untouched, for the person it belongs to.
    expect((await board(empA1.token)).find((task) => task.id === id)?.title).toBe('Mine alone')
  })

  it('lets the chain owner, who holds no branch, keep a private list of their own', async () => {
    const created = await createTask(owner, {
      title: 'Call the accountant',
      personal: true,
      assigneeIds: [
        (
          await harness.app.inject({
            method: 'GET',
            url: '/auth/me',
            headers: { authorization: `Bearer ${owner}` },
          })
        ).json<{ userId: string }>().userId,
      ],
    })
    expect(created.statusCode).toBe(201)
    expect(created.json<BoardTask>().locationId).toBeNull()
    expect(created.json<BoardTask>().personal).toBe(true)
  })

  it('will not let an edit take a private task public', async () => {
    const created = await createTask(managerA.token, {
      title: 'My own note',
      personal: true,
      assigneeIds: [managerA.userId],
    })
    expect(created.statusCode).toBe(201)
    const id = created.json<BoardTask>().id

    // Adding a second assignee is the way a private task would leak: refused outright.
    const shared = await updateTask(managerA.token, id, {
      title: 'My own note',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [managerA.userId, empA1.userId],
    })
    expect(shared.statusCode).toBe(400)
    expect((await board(empA1.token)).map((task) => task.id)).not.toContain(id)

    // Editing it as what it is still works.
    const renamed = await updateTask(managerA.token, id, {
      title: 'My own note, revised',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [managerA.userId],
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<BoardTask>().title).toBe('My own note, revised')
  })

  it('gives an employee full control over their own private task', async () => {
    // The owner's call of 2026-08-25: "if its on personal task we must have full control over it".
    // An employee holds no tasks.manage, so before this they could write a private note and then
    // never correct it — the board's edit path was the only one, and it was shut to them.
    const created = await createTask(empA1.token, {
      title: 'Renew my licence',
      personal: true,
      assigneeIds: [empA1.userId],
    })
    expect(created.statusCode).toBe(201)
    const id = created.json<BoardTask>().id

    const edited = await updateTask(empA1.token, id, {
      title: 'Renew my food handling licence',
      description: 'Before the end of the month',
      priority: 'high',
      dueDate: null,
      assigneeIds: [empA1.userId],
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json<BoardTask>().title).toBe('Renew my food handling licence')

    expect((await deleteTask(empA1.token, id)).statusCode).toBe(200)
    expect((await board(empA1.token)).map((task) => task.id)).not.toContain(id)
  })

  it('will not let a private task be assigned to anybody but its writer', async () => {
    // Reaching the shared board through the private path: refused for every role, including the
    // ones that hold the board outright, because a task nobody else can read cannot name them.
    for (const [who, token, id] of [
      ['employee', empA1.token, empA1.userId],
      ['manager', managerA.token, managerA.userId],
    ] as const) {
      const created = await createTask(token, {
        title: `A note from the ${who}`,
        personal: true,
        assigneeIds: [id],
      })
      expect(created.statusCode).toBe(201)
      const taskId = created.json<BoardTask>().id

      const shared = await updateTask(token, taskId, {
        title: `A note from the ${who}`,
        description: null,
        priority: 'normal',
        dueDate: null,
        assigneeIds: [id, adminA.userId],
      })
      expect(shared.statusCode).toBe(400)

      // Handing it over entirely is the same refusal, not a loophole.
      const handed = await updateTask(token, taskId, {
        title: `A note from the ${who}`,
        description: null,
        priority: 'normal',
        dueDate: null,
        assigneeIds: [adminA.userId],
      })
      expect(handed.statusCode).toBe(400)

      // Still exactly one assignee, and still nobody else's to read.
      const mine = (await board(token)).find((task) => task.id === taskId)
      expect(mine?.assignees.map((one) => one.id)).toEqual([id])
      expect((await board(adminA.token)).map((task) => task.id)).not.toContain(taskId)
    }
  })

  it('keeps a private-only caller off the shared board entirely', async () => {
    // The other side of the same key: the edit path is open to them now, so it has to refuse the
    // branch's work as firmly as the route used to.
    const shared = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: adminA.userId,
        title: 'The branch admin said so',
        assigneeIds: [empA1.userId],
      })
    ).id

    const edit = await updateTask(empA1.token, shared, {
      title: 'Not any more',
      description: null,
      priority: 'normal',
      dueDate: null,
      assigneeIds: [empA1.userId],
    })
    expect(edit.statusCode).toBe(404)
    expect((await deleteTask(empA1.token, shared)).statusCode).toBe(404)

    // Their one shared-board write still works: moving the status of what they were given.
    const moved = await harness.app.inject({
      method: 'POST',
      url: `/tasks/${shared}/status`,
      headers: { authorization: `Bearer ${empA1.token}` },
      payload: { status: 'in_progress' },
    })
    expect(moved.statusCode).toBe(200)
    expect((await board(empA1.token)).find((task) => task.id === shared)?.title).toBe(
      'The branch admin said so',
    )
  })

  // --- the manager remit ---

  it('refuses a manager assigning work to the branch admin above them', async () => {
    const refused = await createTask(managerA.token, {
      title: 'Do this, boss',
      assigneeIds: [adminA.userId],
    })
    expect(refused.statusCode).toBe(403)

    // Their own level and below is the ladder, and both halves of it work.
    const peer = await provision('mgr-b@burgers.local', 'manager', locationAId)
    const allowed = await createTask(managerA.token, {
      title: 'Cover the close',
      assigneeIds: [peer.userId, empA1.userId],
    })
    expect(allowed.statusCode).toBe(201)
  })

  it('lets a manager edit and delete the work they wrote, and nobody else’s', async () => {
    const theirs = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: managerA.userId,
        title: 'Mine to give',
        assigneeIds: [empA1.userId],
      })
    ).id
    const admins = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: adminA.userId,
        title: 'The branch admin said so',
        assigneeIds: [empA1.userId],
      })
    ).id

    const edit = (id: string) =>
      updateTask(managerA.token, id, {
        title: 'Renamed',
        description: null,
        priority: 'normal',
        dueDate: null,
        assigneeIds: [empA1.userId],
      })

    expect((await edit(theirs)).statusCode).toBe(200)
    // Seen on their board, but not theirs to rewrite — and the refusal reveals nothing more than
    // an unknown id would.
    expect((await edit(admins)).statusCode).toBe(404)
    expect((await deleteTask(managerA.token, admins)).statusCode).toBe(404)
    expect((await board(managerA.token)).map((task) => task.title)).toContain(
      'The branch admin said so',
    )

    // The status path is untouched: running the shift means moving the work along, whoever set it.
    const moved = await harness.app.inject({
      method: 'POST',
      url: `/tasks/${admins}/status`,
      headers: { authorization: `Bearer ${managerA.token}` },
      payload: { status: 'in_progress' },
    })
    expect(moved.statusCode).toBe(200)

    expect((await deleteTask(managerA.token, theirs)).statusCode).toBe(200)
  })

  it('leaves the branch admin able to edit anything on their own board', async () => {
    const managers = (
      await harness.seedTask({
        locationId: locationAId,
        createdBy: managerA.userId,
        title: 'The manager set this',
        assigneeIds: [empA1.userId],
      })
    ).id

    const edit = await updateTask(adminA.token, managers, {
      title: 'The branch admin revised it',
      description: null,
      priority: 'high',
      dueDate: null,
      assigneeIds: [managerA.userId],
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json<BoardTask>().assignees.map((one) => one.id)).toEqual([managerA.userId])
  })
})
