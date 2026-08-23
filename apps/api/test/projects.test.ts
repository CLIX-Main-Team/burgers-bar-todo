import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The projects surface, driven end to end through real HTTP. What these cases are actually for is
// the scope boundary (ADR-0007) and the two invariants the design rests on:
//
//   1. A project's progress is DERIVED. There is no percent column, so a case can only move it by
//      moving tasks — which is the point. If someone later adds a stored figure, the "ticking a
//      task moves the project" case is what breaks.
//   2. Deleting a project must NOT delete its tasks. Losing a grouping must never lose work, and
//      that is a `set null` FK nobody would notice regressing without a test standing on it.
//
// Users are provisioned through the real invite/accept flow; nothing reads rows directly.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface ProvisionedUser {
  userId: string
  token: string
}

describe('projects', () => {
  let harness: TestHarness
  let locationAId: string
  let locationBId: string
  let admin: string
  let managerA: ProvisionedUser
  let employeeA: ProvisionedUser

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness.close()
  })

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    admin = await signIn(SEED_EMAIL, SEED_PASSWORD)
    locationAId = (await harness.seedLocation({ name: 'Herzliya' })).id
    locationBId = (await harness.seedLocation({ name: 'Ramat Gan' })).id
    managerA = await provision('manager-a@burgers.local', 'manager', locationAId)
    employeeA = await provision('employee-a@burgers.local', 'employee', locationAId)
  })

  async function signIn(email: string, password: string): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email, password },
    })
    expect(response.statusCode).toBe(200)
    return response.json().token
  }

  async function provision(
    email: string,
    role: 'manager' | 'employee',
    locationId: string,
  ): Promise<ProvisionedUser> {
    const invite = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName: email, role, locationId },
    })
    expect(invite.statusCode).toBe(201)
    const userId = invite.json().id
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    expect(match).not.toBeNull()
    const accept = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: {
        token: (match as RegExpExecArray)[1],
        password: GOOD_PASSWORD,
        preferredLanguage: 'he',
      },
    })
    expect(accept.statusCode).toBe(200)
    return { userId, token: accept.json().token }
  }

  function createProject(
    token: string,
    body: Record<string, unknown>,
  ): ReturnType<typeof harness.app.inject> {
    return harness.app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'A project', icon: 'menu', colour: 'amber', ...body },
    })
  }

  function listProjects(token: string): ReturnType<typeof harness.app.inject> {
    return harness.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  describe('the role guard', () => {
    it('refuses an employee the whole surface', async () => {
      const read = await listProjects(employeeA.token)
      expect(read.statusCode).toBe(403)

      const write = await createProject(employeeA.token, { name: 'Not mine to make' })
      expect(write.statusCode).toBe(403)
    })

    it('refuses an anonymous caller', async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/projects' })
      expect(response.statusCode).toBe(401)
    })
  })

  describe('the scope predicate', () => {
    // The half of the predicate that differs from the board's: a manager DOES see chain-wide
    // projects, because a menu rollout has no branch and a manager who could not see it could not
    // see the work their own staff are doing inside it.
    it('shows a manager their own branch and every chain-wide project, and nobody else’s branch', async () => {
      await createProject(admin, { name: 'Herzliya fit-out', locationId: locationAId })
      await createProject(admin, { name: 'Ramat Gan fit-out', locationId: locationBId })
      await createProject(admin, { name: 'Winter menu', locationId: null })

      const response = await listProjects(managerA.token)
      expect(response.statusCode).toBe(200)
      const names = response.json().projects.map((project: { name: string }) => project.name)
      expect(names).toContain('Herzliya fit-out')
      expect(names).toContain('Winter menu')
      expect(names).not.toContain('Ramat Gan fit-out')
    })

    it('shows an admin the whole chain', async () => {
      await createProject(admin, { name: 'Herzliya fit-out', locationId: locationAId })
      await createProject(admin, { name: 'Ramat Gan fit-out', locationId: locationBId })

      const response = await listProjects(admin)
      expect(response.json().projects).toHaveLength(2)
    })

    it('refuses a manager filing a project onto another branch', async () => {
      const response = await createProject(managerA.token, {
        name: 'Reaching past my branch',
        locationId: locationBId,
      })
      expect(response.statusCode).toBe(403)
    })

    // A project outside scope must be indistinguishable from one that does not exist, so an id
    // never confirms a row on another branch.
    it('answers 404, not 403, for a project outside the caller’s scope', async () => {
      const other = await createProject(admin, {
        name: 'Ramat Gan fit-out',
        locationId: locationBId,
      })
      const id = other.json().id

      const read = await harness.app.inject({
        method: 'GET',
        url: `/projects/${id}`,
        headers: { authorization: `Bearer ${managerA.token}` },
      })
      expect(read.statusCode).toBe(404)
    })
  })

  describe('progress is derived from the tasks, never stored', () => {
    it('reads not_started with no tasks — never done', async () => {
      const created = await createProject(admin, { name: 'Nothing planned yet' })
      expect(created.statusCode).toBe(201)
      // The vacuous-truth case: 0 of 0 must not read as complete, or the screen would tell a
      // manager a branch opening with nothing planned had already happened.
      expect(created.json().status).toBe('not_started')
      expect(created.json().taskCount).toBe(0)
    })

    it('moves through in_progress to done as its tasks are ticked', async () => {
      const project = (await createProject(admin, { name: 'Winter menu' })).json()

      const taskIds: string[] = []
      for (const title of ['One', 'Two']) {
        const task = await harness.app.inject({
          method: 'POST',
          url: '/tasks',
          headers: { authorization: `Bearer ${managerA.token}` },
          payload: { title, projectId: project.id },
        })
        expect(task.statusCode).toBe(201)
        expect(task.json().projectId).toBe(project.id)
        taskIds.push(task.json().id)
      }

      const afterAdding = await readProject(managerA.token, project.id)
      expect(afterAdding.status).toBe('not_started')
      expect(afterAdding.taskCount).toBe(2)

      await setStatus(managerA.token, taskIds[0] as string, 'done')
      const halfway = await readProject(managerA.token, project.id)
      expect(halfway.status).toBe('in_progress')
      expect(halfway.doneCount).toBe(1)

      await setStatus(managerA.token, taskIds[1] as string, 'done')
      const finished = await readProject(managerA.token, project.id)
      expect(finished.status).toBe('done')
      expect(finished.doneCount).toBe(2)
    })

    // The counts must describe exactly the rows the same caller would be shown inside the project,
    // or the card prints a number the list underneath it contradicts.
    it('counts only the tasks the caller may see', async () => {
      const project = (await createProject(admin, { name: 'Chain-wide' })).json()
      await harness.seedTask({ locationId: locationAId, title: 'Mine', projectId: project.id })
      await harness.seedTask({ locationId: locationBId, title: 'Theirs', projectId: project.id })

      const asAdmin = await readProject(admin, project.id)
      expect(asAdmin.taskCount).toBe(2)

      const asManager = await readProject(managerA.token, project.id)
      expect(asManager.taskCount).toBe(1)
      const detail = await harness.app.inject({
        method: 'GET',
        url: `/projects/${project.id}`,
        headers: { authorization: `Bearer ${managerA.token}` },
      })
      // The number and the list agree, which is the whole reason the counts are scoped.
      expect(detail.json().tasks).toHaveLength(1)
    })
  })

  describe('deleting a project', () => {
    it('leaves its tasks on the board, unfiled', async () => {
      const project = (await createProject(admin, { name: 'Winter menu' })).json()
      const task = await harness.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { authorization: `Bearer ${managerA.token}` },
        payload: { title: 'Survives its project', projectId: project.id },
      })
      const taskId = task.json().id

      const removed = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/delete`,
        headers: { authorization: `Bearer ${admin}` },
      })
      expect(removed.statusCode).toBe(200)

      const board = await harness.app.inject({
        method: 'GET',
        url: '/tasks',
        headers: { authorization: `Bearer ${managerA.token}` },
      })
      const survivor = board.json().tasks.find((one: { id: string }) => one.id === taskId)
      expect(survivor).toBeDefined()
      // Still on the board, no longer filed — the grouping went, the work did not.
      expect(survivor.projectId).toBeNull()
    })
  })

  describe('filing a task into a project', () => {
    it('refuses a project the caller may not see, rather than silently dropping the filing', async () => {
      const other = await createProject(admin, {
        name: 'Ramat Gan fit-out',
        locationId: locationBId,
      })

      const response = await harness.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { authorization: `Bearer ${managerA.token}` },
        payload: { title: 'Smuggled in', projectId: other.json().id },
      })
      // 400, not 201-with-null: a create that quietly lost the filing would look like success.
      expect(response.statusCode).toBe(400)
    })
  })

  async function readProject(token: string, id: string) {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json().projects.find((project: { id: string }) => project.id === id)
  }

  function setStatus(token: string, taskId: string, status: string) {
    return harness.app.inject({
      method: 'POST',
      url: `/tasks/${taskId}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status },
    })
  }
})
