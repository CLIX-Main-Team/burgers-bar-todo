import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The Access surface (owner ask 2026-08-24): role capabilities as data the chain owner
// edits, enforced by the API. Every case drives real HTTP and asserts external behaviour
// only. The load-bearing rules: reading the matrix is open to every signed-in role but
// editable only reads true for a super_admin; writing is super_admin-only and the
// super_admin column itself is refused even to them; and a flipped switch changes what the
// guarded routes ACCEPT — proven by watching a 403 become a 2xx and back, and by the
// personal-create path's own containment (self only, own branch only, no project).

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

describe('access: the owner-edited role capabilities (2026-08-24)', () => {
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

  const adminToken = () => signIn(SEED_EMAIL, SEED_PASSWORD)

  const latestInviteToken = (): string => {
    const mail = harness.mailer.sent.at(-1)
    const match = /token=([\w-]+)/.exec(mail?.text ?? '')
    return (match as RegExpExecArray)[1]
  }

  // Provision any role through the real invite/accept flow, so every case proves the API
  // re-authorises the principal. A super_admin invitee carries no location, branch roles a
  // seeded one.
  const provision = async (
    role: 'super_admin' | 'admin' | 'manager' | 'employee',
    email: string,
    locationId?: string,
  ): Promise<string> => {
    const admin = await adminToken()
    const location =
      role === 'super_admin'
        ? null
        : { id: locationId ?? (await harness.seedLocation({ name: 'Home Branch' })).id }
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: { email, displayName: email, role, locationId: location?.id ?? null },
    })
    expect(invited.statusCode).toBe(201)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return accepted.json<{ token: string }>().token
  }

  const getMatrix = (token: string): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'GET',
      url: '/access',
      headers: { authorization: `Bearer ${token}` },
    })

  const flip = (
    token: string,
    role: string,
    capability: string,
    allowed: boolean,
  ): Promise<LightMyRequestResponse> =>
    harness.app.inject({
      method: 'POST',
      url: '/access/update',
      headers: { authorization: `Bearer ${token}` },
      payload: { role, capability, allowed },
    })

  const me = async (token: string) => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ userId: string; capabilities: string[] }>()
  }

  it('serves the matrix to the super_admin alone (2026-08-25)', async () => {
    const anonymous = await harness.app.inject({ method: 'GET', url: '/access' })
    expect(anonymous.statusCode).toBe(401)

    // The page used to describe the rules to everyone who lived under them; the owner's call is
    // that the shape of the chain's authority is his to look at, and page.access says so.
    for (const role of ['employee', 'manager', 'admin'] as const) {
      const other = await provision(role, `${role}@example.com`)
      expect((await getMatrix(other)).statusCode).toBe(403)
    }

    const owner = await provision('super_admin', 'owner@example.com')
    const asOwner = await getMatrix(owner)
    expect(asOwner.statusCode).toBe(200)
    const body = asOwner.json<{
      editable: boolean
      matrix: Array<{ capability: string; byRole: Record<string, boolean> }>
    }>()
    expect(body.editable).toBe(true)
    // The defaults are the owner's 2026-08-25 brief, role by role.
    const row = (key: string) => body.matrix.find((entry) => entry.capability === key)
    expect(row('page.dashboard')?.byRole).toEqual({
      super_admin: true,
      admin: true,
      manager: false,
      employee: false,
    })
    expect(row('page.access')?.byRole).toEqual({
      super_admin: true,
      admin: false,
      manager: false,
      employee: false,
    })
    expect(row('projects.manage')?.byRole.manager).toBe(false)
    expect(row('projects.checklist')?.byRole.employee).toBe(true)
    expect(row('tasks.createPersonal')?.byRole.employee).toBe(true)
    expect(row('people.manageInvites')?.byRole.manager).toBe(false)
    expect(row('page.locations')?.byRole.manager).toBe(true)
    expect(row('locations.manage')?.byRole).toEqual({
      super_admin: true,
      admin: true,
      manager: false,
      employee: false,
    })
  })

  it('lets only a super_admin write, and never the super_admin column', async () => {
    // The seed account is the bootstrap super_admin since the branch-admin split, so the
    // refused mid-tier caller has to be a provisioned branch admin.
    const admin = await provision('admin', 'branch-admin@example.com')
    expect((await flip(admin, 'employee', 'page.knowledge', true)).statusCode).toBe(403)

    const manager = await provision('manager', 'manager@example.com')
    expect((await flip(manager, 'employee', 'page.knowledge', true)).statusCode).toBe(403)

    const owner = await provision('super_admin', 'owner@example.com')
    expect((await flip(owner, 'super_admin', 'tasks.manage', false)).statusCode).toBe(403)
    expect((await flip(owner, 'employee', 'page.knowledge', true)).statusCode).toBe(200)

    const unknownKey = await harness.app.inject({
      method: 'POST',
      url: '/access/update',
      headers: { authorization: `Bearer ${owner}` },
      payload: { role: 'employee', capability: 'no.such.capability', allowed: true },
    })
    expect(unknownKey.statusCode).toBe(400)
  })

  it('changes what the guarded routes accept, live, and back again', async () => {
    const owner = await provision('super_admin', 'owner@example.com')
    const location = await harness.seedLocation({ name: 'Branch A' })
    const manager = await provision('manager', 'manager@example.com', location.id)
    const employee = await provision('employee', 'employee@example.com', location.id)
    // A separate target for the deactivate exercise: deactivation revokes the victim's own
    // sessions, and the employee above must stay signed in for the page-read case below.
    const victim = await provision('employee', 'victim@example.com', location.id)

    // A manager cannot deactivate by default; the owner's switch turns the power on and off
    // again, observed through the same endpoint.
    const employeeId = (await me(victim)).userId
    const deactivate = (token: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/users/${employeeId}/deactivate`,
        headers: { authorization: `Bearer ${token}` },
      })
    expect((await deactivate(manager)).statusCode).toBe(403)
    expect((await flip(owner, 'manager', 'people.deactivate', true)).statusCode).toBe(200)
    expect((await deactivate(manager)).statusCode).toBe(200)
    const reactivated = await harness.app.inject({
      method: 'POST',
      url: `/users/${employeeId}/reactivate`,
      headers: { authorization: `Bearer ${manager}` },
    })
    expect(reactivated.statusCode).toBe(200)
    expect((await flip(owner, 'manager', 'people.deactivate', false)).statusCode).toBe(200)
    expect((await deactivate(manager)).statusCode).toBe(403)

    // Taking a page away refuses its read.
    expect((await flip(owner, 'employee', 'page.assistant', false)).statusCode).toBe(200)
    const threads = await harness.app.inject({
      method: 'GET',
      url: '/threads',
      headers: { authorization: `Bearer ${employee}` },
    })
    expect(threads.statusCode).toBe(403)

    // /auth/me reports the live list: the flip is visible on the very next fetch.
    const employeeCapabilities = (await me(employee)).capabilities
    expect(employeeCapabilities).not.toContain('page.assistant')
    expect(employeeCapabilities).toContain('page.tasks')
  })

  it('personal create: self only, no branch, no project — and no wider write', async () => {
    const owner = await provision('super_admin', 'owner@example.com')
    const location = await harness.seedLocation({ name: 'Branch A' })
    const employee = await provision('employee', 'employee@example.com', location.id)
    const employeeId = (await me(employee)).userId

    const createTask = (payload: Record<string, unknown>) =>
      harness.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { authorization: `Bearer ${employee}` },
        payload: { title: 'My own task', personal: true, assigneeIds: [employeeId], ...payload },
      })

    // Naming anyone else, or a project, is refused — never repaired.
    const admin = await adminToken()
    const adminId = (await me(admin)).userId
    expect((await createTask({ assigneeIds: [adminId] })).statusCode).toBe(400)
    expect((await createTask({ assigneeIds: [employeeId, adminId] })).statusCode).toBe(400)
    expect(
      (await createTask({ projectId: '99999999-9999-9999-9999-999999999999' })).statusCode,
    ).toBe(400)

    // The straight private task belongs to the writer and to no branch at all.
    const created = await createTask({})
    expect(created.statusCode).toBe(201)
    const task = created.json<{
      locationId: string | null
      personal: boolean
      assignees: Array<{ id: string }>
    }>()
    expect(task.locationId).toBeNull()
    expect(task.personal).toBe(true)
    expect(task.assignees.map((assignee) => assignee.id)).toEqual([employeeId])

    // Every account keeps the private list, so taking it away is a switch like any other.
    expect((await flip(owner, 'employee', 'tasks.createPersonal', false)).statusCode).toBe(200)
    expect((await createTask({})).statusCode).toBe(403)
    expect((await flip(owner, 'employee', 'tasks.createPersonal', true)).statusCode).toBe(200)

    // The private path is not a way into the shared board: that still needs tasks.manage.
    expect((await createTask({ personal: false })).statusCode).toBe(403)

    // Nor is it a way into the full edit — but the writer may still edit their own private task.
    const createdId = created.json<{ id: string }>().id
    const edit = await harness.app.inject({
      method: 'POST',
      url: `/tasks/${createdId}/update`,
      headers: { authorization: `Bearer ${employee}` },
      payload: {
        title: 'Renamed',
        description: null,
        priority: 'normal',
        dueDate: null,
        assigneeIds: [employeeId],
      },
    })
    expect(edit.statusCode).toBe(403)
  })
})
