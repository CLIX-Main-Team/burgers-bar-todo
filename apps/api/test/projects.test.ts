import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The projects surface, driven end to end through real HTTP. What these cases are actually for is
// the scope boundary (ADR-0007) and the two invariants the design rests on:
//
//   1. A project's progress is DERIVED from its checklist. There is no percent column, so a case
//      can only move it by ticking items — which is the point. If someone later adds a stored
//      figure, the "ticking an item moves the project" case is what breaks.
//   2. Ticking the LAST item closes the project by itself, and un-ticking one re-opens it. That
//      pair is the owner's rule (2026-08-23) and the reason there is no "mark done" button.
//   3. Roles are a scope boundary, not a label: a project that does not name an employee's role
//      does not exist as far as that employee is concerned.
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
      payload: {
        name: 'A project',
        icon: 'menu',
        colour: 'amber',
        roles: ['manager'],
        ...body,
      },
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
    // Reads are open to every role since projects gained their own roles field — an employee has a
    // projects view, it is just a shorter one. Writes stay manager-and-up.
    it('lets an employee read, and refuses them every write', async () => {
      const read = await listProjects(employeeA.token)
      expect(read.statusCode).toBe(200)

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
      await createProject(admin, { name: 'Herzliya fit-out', locationIds: [locationAId] })
      await createProject(admin, { name: 'Ramat Gan fit-out', locationIds: [locationBId] })
      await createProject(admin, { name: 'Winter menu', locationIds: [] })

      const response = await listProjects(managerA.token)
      expect(response.statusCode).toBe(200)
      const names = response.json().projects.map((project: { name: string }) => project.name)
      expect(names).toContain('Herzliya fit-out')
      expect(names).toContain('Winter menu')
      expect(names).not.toContain('Ramat Gan fit-out')
    })

    it('shows an admin the whole chain', async () => {
      await createProject(admin, { name: 'Herzliya fit-out', locationIds: [locationAId] })
      await createProject(admin, { name: 'Ramat Gan fit-out', locationIds: [locationBId] })

      const response = await listProjects(admin)
      expect(response.json().projects).toHaveLength(2)
    })

    // The owner's 2026-08-23 call, and the case that proves roles are a boundary rather than a
    // label: an employee sees only the projects that name their role.
    it('hides a project from an employee whose role it does not name', async () => {
      await createProject(admin, {
        name: 'Managers only',
        locationIds: [locationAId],
        roles: ['manager'],
      })
      await createProject(admin, {
        name: 'Everyone at the branch',
        locationIds: [locationAId],
        roles: ['manager', 'employee'],
      })

      const asEmployee = await listProjects(employeeA.token)
      const names = asEmployee.json().projects.map((project: { name: string }) => project.name)
      expect(names).toEqual(['Everyone at the branch'])

      // The manager is on both, so the roles field is genuinely filtering rather than the branch.
      const asManager = await listProjects(managerA.token)
      expect(asManager.json().projects).toHaveLength(2)
    })

    // The roles picker offers all four roles since 2026-08-23, which makes this worth pinning: an
    // admin is not filtered by the roles field at all. Naming roles records who is INVOLVED;
    // leaving admin out cannot take a project away from them, and the form's hint says so.
    it('shows an admin a project that names only employees', async () => {
      await createProject(admin, {
        name: 'Employees only',
        locationIds: [locationBId],
        roles: ['employee'],
      })

      const response = await listProjects(admin)
      const names = response.json().projects.map((project: { name: string }) => project.name)
      expect(names).toEqual(['Employees only'])
    })

    it('refuses a manager filing a project onto another branch', async () => {
      const response = await createProject(managerA.token, {
        name: 'Reaching past my branch',
        locationIds: [locationBId],
      })
      expect(response.statusCode).toBe(403)
    })

    // The owner's 2026-08-23 ask: a project runs at two branches without being two projects. Both
    // branches' managers see the one row, and it is genuinely the same row rather than a copy.
    it('shows a two-branch project to the managers of both branches, and to nobody else', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const managerC = await provision(
        'manager-c@burgers.local',
        'manager',
        (await harness.seedLocation({ name: 'Netanya' })).id,
      )
      const created = await createProject(admin, {
        name: 'Two-branch rollout',
        locationIds: [locationAId, locationBId],
      })
      expect(created.statusCode).toBe(201)
      expect(created.json().locations.map((branch: { name: string }) => branch.name)).toEqual([
        'Herzliya',
        'Ramat Gan',
      ])

      const idFor = async (token: string) => {
        const list = await listProjects(token)
        return list
          .json()
          .projects.filter((project: { name: string }) => project.name === 'Two-branch rollout')
          .map((project: { id: string }) => project.id)
      }
      expect(await idFor(managerA.token)).toEqual([created.json().id])
      expect(await idFor(managerB.token)).toEqual([created.json().id])
      expect(await idFor(managerC.token)).toEqual([])
    })

    // The same check on the edit path as on the create path. Without it a manager could reach past
    // their own branch by editing rather than creating, which is the identical hole down a longer
    // corridor.
    it('refuses a manager widening a project onto another branch', async () => {
      const project = (
        await createProject(managerA.token, {
          name: 'Mine to run',
          locationIds: [locationAId],
        })
      ).json()

      const widened = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/update`,
        headers: { authorization: `Bearer ${managerA.token}` },
        payload: {
          name: 'Mine to run',
          icon: 'menu',
          colour: 'amber',
          roles: ['manager'],
          locationIds: [locationAId, locationBId],
          startDate: null,
          targetDate: null,
          phase: 'planning',
        },
      })
      expect(widened.statusCode).toBe(403)

      // And the project still runs where it did — a refused write changes nothing.
      const after = await readDetail(managerA.token, project.id)
      expect(after.project.locations.map((branch: { name: string }) => branch.name)).toEqual([
        'Herzliya',
      ])
    })

    // A project outside scope must be indistinguishable from one that does not exist, so an id
    // never confirms a row on another branch.
    it('answers 404, not 403, for a project outside the caller’s scope', async () => {
      const other = await createProject(admin, {
        name: 'Ramat Gan fit-out',
        locationIds: [locationBId],
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

  describe('progress is derived from the checklist, never stored', () => {
    it('reads not_started with no checklist — never done', async () => {
      const created = await createProject(admin, { name: 'Nothing planned yet' })
      expect(created.statusCode).toBe(201)
      // The vacuous-truth case: 0 of 0 must not read as complete, or the screen would tell a
      // manager a branch opening with nothing planned had already happened.
      expect(created.json().status).toBe('not_started')
      expect(created.json().taskCount).toBe(0)
      expect(created.json().phase).toBe('planning')
    })

    it('writes the checklist the create carried, and counts it', async () => {
      const created = await createProject(admin, {
        name: 'Winter menu',
        checklist: ['One', 'Two', 'Three'],
      })
      expect(created.json().taskCount).toBe(3)
      expect(created.json().doneCount).toBe(0)

      const detail = await readDetail(managerA.token, created.json().id)
      expect(detail.checklist.map((item: { title: string }) => item.title)).toEqual([
        'One',
        'Two',
        'Three',
      ])
    })

    // The rule the owner asked for, and its mirror. Both halves matter: without the second, a
    // project would keep claiming to be finished after somebody reopened work inside it.
    it('closes itself when the last item is ticked, and re-opens when one is un-ticked', async () => {
      const project = (
        await createProject(admin, { name: 'Winter menu', checklist: ['One', 'Two'] })
      ).json()
      const items = (await readDetail(managerA.token, project.id)).checklist

      const halfway = await setItem(managerA.token, project.id, items[0].id, true)
      expect(halfway.json().project.status).toBe('in_progress')
      // Still in the phase it was created in — only the LAST tick moves it.
      expect(halfway.json().project.phase).toBe('planning')

      const finished = await setItem(managerA.token, project.id, items[1].id, true)
      expect(finished.json().project.status).toBe('done')
      expect(finished.json().project.phase).toBe('completed')
      expect(finished.json().project.doneCount).toBe(2)

      const reopened = await setItem(managerA.token, project.id, items[1].id, false)
      expect(reopened.json().project.phase).toBe('in_progress')
      expect(reopened.json().project.status).toBe('in_progress')
    })

    it('re-opens a completed project when a new item is added to it', async () => {
      const project = (
        await createProject(admin, { name: 'Kashrut audit', checklist: ['Only step'] })
      ).json()
      const items = (await readDetail(managerA.token, project.id)).checklist
      const closed = await setItem(managerA.token, project.id, items[0].id, true)
      expect(closed.json().project.phase).toBe('completed')

      const added = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/checklist`,
        headers: { authorization: `Bearer ${managerA.token}` },
        payload: { title: 'One more thing' },
      })
      expect(added.statusCode).toBe(201)
      expect(added.json().project.phase).toBe('in_progress')
      expect(added.json().project.taskCount).toBe(2)
    })

    it('refuses an employee every checklist write', async () => {
      const project = (
        await createProject(admin, {
          name: 'Everyone',
          locationIds: [locationAId],
          roles: ['manager', 'employee'],
          checklist: ['One'],
        })
      ).json()
      const items = (await readDetail(employeeA.token, project.id)).checklist
      // They can read it...
      expect(items).toHaveLength(1)
      // ...and cannot move it.
      const write = await setItem(employeeA.token, project.id, items[0].id, true)
      expect(write.statusCode).toBe(403)
    })
  })

  describe('deleting a project', () => {
    it('takes its checklist with it', async () => {
      const project = (
        await createProject(admin, { name: 'Winter menu', checklist: ['One', 'Two'] })
      ).json()

      const removed = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/delete`,
        headers: { authorization: `Bearer ${admin}` },
      })
      expect(removed.statusCode).toBe(200)

      const gone = await harness.app.inject({
        method: 'GET',
        url: `/projects/${project.id}`,
        headers: { authorization: `Bearer ${admin}` },
      })
      expect(gone.statusCode).toBe(404)
    })
  })

  function setItem(token: string, projectId: string, itemId: string, done: boolean) {
    return harness.app.inject({
      method: 'POST',
      url: `/projects/${projectId}/checklist/${itemId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { done },
    })
  }

  async function readDetail(token: string, id: string) {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/projects/${id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json()
  }
})
