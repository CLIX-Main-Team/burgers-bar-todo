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
  // The branch admin: the role that authors projects at one branch since 2026-08-25. `admin` above
  // is the seed account, which the branch-admin split promoted to super_admin.
  let adminA: ProvisionedUser

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
    adminA = await provision('admin-a@burgers.local', 'admin', locationAId)
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

  // The update path replaces every field, so a test that means to change one still has to send
  // them all; this fills in a valid rest-of-the-project around the patch under test.
  function updateProject(
    token: string,
    id: string,
    body: Record<string, unknown>,
  ): ReturnType<typeof harness.app.inject> {
    return harness.app.inject({
      method: 'POST',
      url: `/projects/${id}/update`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'A project',
        icon: 'menu',
        colour: 'amber',
        roles: ['manager'],
        locationIds: [],
        startDate: null,
        targetDate: null,
        phase: 'planning',
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
    // projects view, it is just a shorter one. Authoring is the branch admin's and up since
    // 2026-08-25: a manager runs the shift, they do not decide what the branch works on.
    it('lets an employee read, and refuses them every write', async () => {
      const read = await listProjects(employeeA.token)
      expect(read.statusCode).toBe(200)

      const write = await createProject(employeeA.token, { name: 'Not mine to make' })
      expect(write.statusCode).toBe(403)
    })

    it('refuses a manager the create their branch admin holds', async () => {
      const asManager = await createProject(managerA.token, {
        name: 'Not mine to make',
        locationIds: [locationAId],
      })
      expect(asManager.statusCode).toBe(403)

      const asAdmin = await createProject(adminA.token, {
        name: 'Mine to make',
        locationIds: [locationAId],
      })
      expect(asAdmin.statusCode).toBe(201)
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

    it('refuses a branch admin filing a project anywhere but their own branch', async () => {
      // Another branch, both branches, and the chain-wide empty set: all three are the owner's
      // alone, so all three are refused rather than quietly trimmed to what the admin may have.
      for (const locationIds of [[locationBId], [locationAId, locationBId], []]) {
        const response = await createProject(adminA.token, {
          name: 'Reaching past my branch',
          locationIds,
        })
        expect(response.statusCode).toBe(403)
      }
    })

    // A branch admin used to read every project in the chain: the 2026-08-23 split narrowed the
    // roster and the board to one branch and left this predicate behind (owner call 2026-08-25).
    it('shows a branch admin their own branch and the chain-wide projects', async () => {
      await createProject(admin, { name: 'Herzliya fit-out', locationIds: [locationAId] })
      await createProject(admin, { name: 'Ramat Gan fit-out', locationIds: [locationBId] })
      await createProject(admin, { name: 'Winter menu', locationIds: [], roles: ['admin'] })

      const names = (await listProjects(adminA.token))
        .json()
        .projects.map((project: { name: string }) => project.name)
      expect(names).toContain('Herzliya fit-out')
      expect(names).toContain('Winter menu')
      expect(names).not.toContain('Ramat Gan fit-out')
    })

    // The other half of the same call (owner, 2026-08-25, on seeing it live and then answering his
    // own question): choosing where a project runs is what names its admins. Chain-wide names every
    // admin, so the role list has nothing left to say about them and cannot take the project away.
    it('shows a branch admin every chain-wide project, whatever roles it names', async () => {
      await createProject(admin, {
        name: 'Managers get briefed',
        locationIds: [],
        roles: ['manager'],
      })
      await createProject(admin, {
        name: 'Employees get briefed',
        locationIds: [],
        roles: ['employee'],
      })
      // Another branch's work is still not theirs: place is the axis they answer to, so it is also
      // the one that holds them out.
      await createProject(admin, {
        name: 'Ramat Gan, managers only',
        locationIds: [locationBId],
        roles: ['manager'],
      })

      const names = (await listProjects(adminA.token))
        .json()
        .projects.map((project: { name: string }) => project.name)
      expect(names).toContain('Managers get briefed')
      expect(names).toContain('Employees get briefed')
      expect(names).not.toContain('Ramat Gan, managers only')

      // And the other branch's is not reachable by id either: outside the scope predicate is one
      // 404, never a 403 that would confirm the row exists.
      const hidden = (await listProjects(admin))
        .json()
        .projects.find((project: { name: string }) => project.name === 'Ramat Gan, managers only')
      const byId = await harness.app.inject({
        method: 'GET',
        url: `/projects/${hidden.id}`,
        headers: { authorization: `Bearer ${adminA.token}` },
      })
      expect(byId.statusCode).toBe(404)
    })

    // The role axis is the manager's and the employee's, not the admin's: a project filed at their
    // branch is theirs to answer for whether or not the roles picker named them.
    it('shows a branch admin a project at their branch that names only employees', async () => {
      await createProject(admin, {
        name: 'Employees only',
        locationIds: [locationAId],
        roles: ['employee'],
      })
      const names = (await listProjects(adminA.token))
        .json()
        .projects.map((project: { name: string }) => project.name)
      expect(names).toEqual(['Employees only'])
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

    // The same check on the edit path as on the create path. Without it a branch admin could reach
    // past their own branch by editing rather than creating, which is the identical hole down a
    // longer corridor.
    it('refuses a branch admin widening their own project onto another branch', async () => {
      const project = (
        await createProject(adminA.token, {
          name: 'Mine to run',
          locationIds: [locationAId],
        })
      ).json()

      const widened = await updateProject(adminA.token, project.id, {
        locationIds: [locationAId, locationBId],
      })
      expect(widened.statusCode).toBe(403)

      // And the project still runs where it did — a refused write changes nothing.
      const after = await readDetail(adminA.token, project.id)
      expect(after.project.locations.map((branch: { name: string }) => branch.name)).toEqual([
        'Herzliya',
      ])
    })

    // The other half of the same rule (owner call 2026-08-25): a rollout that reaches their branch
    // is theirs to WORK IN, never theirs to rewrite — and it cannot be captured one save at a time
    // by editing it down to their own branch either.
    it('refuses a branch admin editing or deleting a project wider than their branch', async () => {
      const rollout = (
        await createProject(admin, {
          name: 'Two-branch rollout',
          locationIds: [locationAId, locationBId],
          checklist: ['Step one'],
        })
      ).json()

      // They can see it, and tick its checklist.
      const detail = await readDetail(adminA.token, rollout.id)
      expect(detail.project.name).toBe('Two-branch rollout')
      const ticked = await setItem(adminA.token, rollout.id, detail.checklist[0].id, true)
      expect(ticked.statusCode).toBe(200)

      // They cannot rename it, narrow it onto their own branch, restructure it, or delete it.
      // Sent with the rollout's own branches, so what is refused is the authorship, not a
      // side-effect of the branch set changing.
      const renamed = await updateProject(adminA.token, rollout.id, {
        name: 'Mine now',
        locationIds: [locationAId, locationBId],
      })
      expect(renamed.statusCode).toBe(403)
      const narrowed = await updateProject(adminA.token, rollout.id, {
        locationIds: [locationAId],
      })
      expect(narrowed.statusCode).toBe(403)
      const added = await harness.app.inject({
        method: 'POST',
        url: `/projects/${rollout.id}/checklist`,
        headers: { authorization: `Bearer ${adminA.token}` },
        payload: { title: 'A step of my own' },
      })
      expect(added.statusCode).toBe(404)
      const deleted = await harness.app.inject({
        method: 'POST',
        url: `/projects/${rollout.id}/delete`,
        headers: { authorization: `Bearer ${adminA.token}` },
      })
      expect(deleted.statusCode).toBe(404)

      const after = await readDetail(admin, rollout.id)
      expect(after.project.name).toBe('Two-branch rollout')
      expect(after.project.locations).toHaveLength(2)
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
        headers: { authorization: `Bearer ${admin}` },
        payload: { title: 'One more thing' },
      })
      expect(added.statusCode).toBe(201)
      expect(added.json().project.phase).toBe('in_progress')
      expect(added.json().project.taskCount).toBe(2)
    })

    // Ticking a line is doing the work, not authoring the project (owner call 2026-08-25), so it
    // belongs to whoever the project reaches — and stops exactly there.
    it('lets an employee tick a line on a project that names them, but not restructure it', async () => {
      const project = (
        await createProject(admin, {
          name: 'Everyone',
          locationIds: [locationAId],
          roles: ['manager', 'employee'],
          checklist: ['One'],
        })
      ).json()
      const items = (await readDetail(employeeA.token, project.id)).checklist
      expect(items).toHaveLength(1)

      const ticked = await setItem(employeeA.token, project.id, items[0].id, true)
      expect(ticked.statusCode).toBe(200)
      expect(ticked.json().project.doneCount).toBe(1)

      // Adding and striking lines is authorship, and stays with the project's author.
      const added = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/checklist`,
        headers: { authorization: `Bearer ${employeeA.token}` },
        payload: { title: 'A line of my own' },
      })
      expect(added.statusCode).toBe(403)
      const struck = await harness.app.inject({
        method: 'POST',
        url: `/projects/${project.id}/checklist/${items[0].id}/delete`,
        headers: { authorization: `Bearer ${employeeA.token}` },
      })
      expect(struck.statusCode).toBe(403)
    })

    it('lets a manager tick a line without being able to author the project', async () => {
      const project = (
        await createProject(admin, {
          name: 'Branch work',
          locationIds: [locationAId],
          roles: ['manager'],
          checklist: ['One'],
        })
      ).json()
      const items = (await readDetail(managerA.token, project.id)).checklist
      const ticked = await setItem(managerA.token, project.id, items[0].id, true)
      expect(ticked.statusCode).toBe(200)
      const renamed = await updateProject(managerA.token, project.id, { name: 'Renamed' })
      expect(renamed.statusCode).toBe(403)
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

  // --- who a checklist step may be handed to (owner call 2026-08-28) ---
  //
  // These cases are the SQL twin of project-reach.test.ts. That file pins the rule; this one pins
  // that the query actually implements it, and that the write refuses what the query would not
  // have offered.
  describe('step owners', () => {
    async function addItem(token: string, projectId: string, title: string) {
      const added = await harness.app.inject({
        method: 'POST',
        url: `/projects/${projectId}/checklist`,
        headers: { authorization: `Bearer ${token}` },
        payload: { title },
      })
      expect(added.statusCode).toBe(201)
      return added.json().checklist.at(-1).id as string
    }

    function assignable(token: string, projectId: string) {
      return harness.app.inject({
        method: 'GET',
        url: `/projects/${projectId}/assignable`,
        headers: { authorization: `Bearer ${token}` },
      })
    }

    function assign(token: string, projectId: string, itemId: string, userIds: string[]) {
      return harness.app.inject({
        method: 'POST',
        url: `/projects/${projectId}/checklist/${itemId}/assignees`,
        headers: { authorization: `Bearer ${token}` },
        payload: { userIds },
      })
    }

    const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id)

    it('offers a named role at every branch on a chain-wide project', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()

      const response = await assignable(admin, project.id)
      expect(response.statusCode).toBe(200)
      const ids = idsOf(response.json().candidates)
      expect(ids).toContain(managerA.userId)
      expect(ids).toContain(managerB.userId)
      // Never named, and no branch picker put them there either.
      expect(ids).not.toContain(employeeA.userId)
    })

    it('offers only the named branch on a branch project', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const project = (
        await createProject(admin, { locationIds: [locationAId], roles: ['manager'] })
      ).json()

      const ids = idsOf((await assignable(admin, project.id)).json().candidates)
      expect(ids).toContain(managerA.userId)
      expect(ids).not.toContain(managerB.userId)
    })

    // The owner's call, 2026-08-28. A branch admin answers for a place, so on a chain-wide project
    // they hand steps to their own branch and no further - two admins open the same project and
    // legitimately see different name lists.
    it('narrows a chain-wide project to a branch admin own branch', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()

      const ids = idsOf((await assignable(adminA.token, project.id)).json().candidates)
      expect(ids).toContain(managerA.userId)
      expect(ids).not.toContain(managerB.userId)
    })

    it('refuses the roster to a role that cannot assign', async () => {
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      expect((await assignable(managerA.token, project.id)).statusCode).toBe(403)
      expect((await assignable(employeeA.token, project.id)).statusCode).toBe(403)
    })

    it('does not confirm a project the caller cannot see', async () => {
      const project = (
        await createProject(admin, { locationIds: [locationBId], roles: ['manager'] })
      ).json()
      // adminA holds Herzliya; a Ramat Gan project must read as absent, not as forbidden.
      expect((await assignable(adminA.token, project.id)).statusCode).toBe(404)
    })

    it('puts a name on a step and reads it back on the item', async () => {
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')

      const written = await assign(admin, project.id, itemId, [managerA.userId])
      expect(written.statusCode).toBe(200)
      const item = written.json().checklist.find((one: { id: string }) => one.id === itemId)
      expect(item.assignees).toEqual([
        { id: managerA.userId, displayName: 'manager-a@burgers.local' },
      ])

      // Wholesale replace: an empty list clears the step rather than leaving the last name on it.
      const cleared = await assign(admin, project.id, itemId, [])
      expect(cleared.statusCode).toBe(200)
      expect(
        cleared.json().checklist.find((one: { id: string }) => one.id === itemId).assignees,
      ).toEqual([])
    })

    // The picker is a courtesy; this is the rule (ADR-0007). A client holding a stale roster, or
    // one hand-rolling the request, gets the same answer.
    it('refuses a name the project does not reach', async () => {
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')

      const response = await assign(admin, project.id, itemId, [employeeA.userId])
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('not_assignable')
    })

    it('refuses a branch admin a name outside their own branch', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')

      expect((await assign(adminA.token, project.id, itemId, [managerB.userId])).statusCode).toBe(
        400,
      )
    })

    it('refuses the write to a role that cannot assign', async () => {
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')
      expect((await assign(managerA.token, project.id, itemId, [managerA.userId])).statusCode).toBe(
        403,
      )
    })

    // The card's red counter. An OPEN count, so ticking the step takes it back down.
    it('counts a viewer own un-ticked steps on the list', async () => {
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const first = await addItem(admin, project.id, 'Brief the shift')
      const second = await addItem(admin, project.id, 'Count the till')
      await assign(admin, project.id, first, [managerA.userId])
      await assign(admin, project.id, second, [managerA.userId])

      const mine = (rows: { id: string; myOpenSteps: number }[]) =>
        rows.find((row) => row.id === project.id)?.myOpenSteps
      expect(mine((await listProjects(managerA.token)).json().projects)).toBe(2)
      // Somebody else's steps are not the reader's news.
      expect(mine((await listProjects(adminA.token)).json().projects)).toBe(0)

      await setItem(managerA.token, project.id, first, true)
      expect(mine((await listProjects(managerA.token)).json().projects)).toBe(1)
    })

    // An edit that narrows a project's reach takes the people who fell out off its steps with it.
    // The alternative is a name standing on work its owner can no longer see to say is not theirs.
    it('drops an owner the project stops reaching', async () => {
      const managerB = await provision('manager-b@burgers.local', 'manager', locationBId)
      const project = (await createProject(admin, { locationIds: [], roles: ['manager'] })).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')
      await assign(admin, project.id, itemId, [managerA.userId, managerB.userId])

      // Chain-wide becomes Herzliya alone: manager B is no longer reached, manager A still is.
      const narrowed = await updateProject(admin, project.id, {
        locationIds: [locationAId],
        roles: ['manager'],
      })
      expect(narrowed.statusCode).toBe(200)

      const item = (await readDetail(admin, project.id)).checklist.find(
        (one: { id: string }) => one.id === itemId,
      )
      expect(idsOf(item.assignees)).toEqual([managerA.userId])
    })

    it('leaves owners alone when an edit widens the project', async () => {
      const project = (
        await createProject(admin, { locationIds: [locationAId], roles: ['manager'] })
      ).json()
      const itemId = await addItem(admin, project.id, 'Brief the shift')
      await assign(admin, project.id, itemId, [managerA.userId])

      const widened = await updateProject(admin, project.id, {
        locationIds: [],
        roles: ['manager', 'employee'],
      })
      expect(widened.statusCode).toBe(200)

      const item = (await readDetail(admin, project.id)).checklist.find(
        (one: { id: string }) => one.id === itemId,
      )
      expect(idsOf(item.assignees)).toEqual([managerA.userId])
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
