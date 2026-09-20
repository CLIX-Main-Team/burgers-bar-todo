import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { seedAdmin } from '../src/auth/seed-admin.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// Departments and task subjects (owner ask 2026-09-20). Shared work is filed under a subject, a
// subject under a department, and a second horizon — tasks.departments — narrows the board on top
// of the branch rule: `chain` sees every department, `department` only the one on the viewer's own
// row, and a viewer with no department sees nothing. The cases here prove that horizon end to end
// through the real routes: the subjects read, the three subject writes behind
// tasks.manageSubjects, the filing rule on task create and move, and the board read the assistant
// and the dashboard share. Every assertion is external: a status, a body, a follow-up read.

const SEED_EMAIL = 'admin@burgers.local'
const SEED_PASSWORD = 'seed-password-123'
const GOOD_PASSWORD = 'valid-password-123'

interface Provisioned {
  userId: string
  token: string
}

interface SubjectCard {
  id: string
  departmentId: string
  locationId: string | null
  locationName: string | null
  name: string
  description: string | null
  openCount: number
  doneCount: number
  assignees: { id: string }[]
  assigneeOverflow: number
}

describe('departments and task subjects (2026-09-20)', () => {
  let harness: TestHarness
  let owner: string
  let locationId: string
  let finance: string
  let marketing: string
  let financeManager: Provisioned
  let unplacedManager: Provisioned

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  const ownerToken = async (): Promise<string> => {
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
    role: 'admin' | 'manager' | 'employee',
    departmentId: string | null,
    branchId: string = locationId,
  ): Promise<Provisioned> => {
    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${owner}` },
      payload: { email, displayName: email, role, locationId: branchId, departmentId },
    })
    expect(invited.statusCode).toBe(201)
    expect(invited.json<{ departmentId: string | null }>().departmentId).toBe(departmentId)
    const accepted = await harness.app.inject({
      method: 'POST',
      url: '/auth/accept',
      payload: { token: latestInviteToken(), password: GOOD_PASSWORD, preferredLanguage: 'en' },
    })
    expect(accepted.statusCode).toBe(200)
    return {
      userId: invited.json<{ id: string }>().id,
      token: accepted.json<{ token: string }>().token,
    }
  }

  const listSubjects = async (token: string, departmentId: string): Promise<SubjectCard[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: `/tasks/subjects?departmentId=${departmentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ subjects: SubjectCard[] }>().subjects
  }

  const createSubject = (token: string, body: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks/subjects',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })

  const createTask = (token: string, body: Record<string, unknown>) =>
    harness.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Task', assigneeIds: [], locationId, ...body },
    })

  const boardIds = async (token: string): Promise<string[]> => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json<{ tasks: { id: string }[] }>().tasks.map((task) => task.id)
  }

  beforeEach(async () => {
    await harness.reset()
    await seedAdmin(harness.components.repo, harness.components.hasher, {
      email: SEED_EMAIL,
      password: SEED_PASSWORD,
    })
    owner = await ownerToken()
    locationId = (await harness.seedLocation({ name: 'Downtown' })).id
    finance = await harness.departmentId('finance')
    marketing = await harness.departmentId('marketing')
    financeManager = await provision('fin@burgers.local', 'manager', finance)
    unplacedManager = await provision('nobody@burgers.local', 'manager', null)
  })

  it('lists the seven departments in the client order to any signed-in person', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/departments',
      headers: { authorization: `Bearer ${unplacedManager.token}` },
    })
    expect(res.statusCode).toBe(200)
    const slugs = res.json<{ departments: { slug: string }[] }>().departments.map((d) => d.slug)
    expect(slugs).toEqual([
      'management',
      'operations',
      'procurement',
      'marketing',
      'call_center',
      'finance',
      'customer_service',
    ])
  })

  it('reports the department on the principal and accepts null on invite', async () => {
    const me = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${financeManager.token}` },
    })
    expect(me.json<{ departmentId: string | null }>().departmentId).toBe(finance)
    const unplaced = await harness.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${unplacedManager.token}` },
    })
    expect(unplaced.json<{ departmentId: string | null }>().departmentId).toBeNull()
  })

  it('refuses an invite naming a department that does not exist', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${owner}` },
      payload: {
        email: 'ghost@burgers.local',
        displayName: 'Ghost',
        role: 'employee',
        locationId,
        departmentId: '00000000-0000-4000-8000-000000000000',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  // --- the subjects read and its horizon ---

  it('shows a chain-horizon viewer every department and a department-held viewer only their own', async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    await harness.seedSubject({ departmentId: marketing, name: 'Campaign' })

    expect((await listSubjects(owner, finance)).map((s) => s.name)).toEqual(['Budget'])
    expect((await listSubjects(owner, marketing)).map((s) => s.name)).toEqual(['Campaign'])

    expect((await listSubjects(financeManager.token, finance)).map((s) => s.id)).toEqual([
      budget.id,
    ])
    // Asking for another department is not refused, it is simply empty: the horizon rides in
    // the WHERE, so a foreign id never learns what it holds.
    expect(await listSubjects(financeManager.token, marketing)).toEqual([])
    // No department at all is nothing at all, not everything.
    expect(await listSubjects(unplacedManager.token, finance)).toEqual([])
  })

  it('counts and faces on a card are the tasks the viewer can see', async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    const other = (await harness.seedLocation({ name: 'Harbour' })).id
    await harness.seedTask({
      locationId,
      subjectId: budget.id,
      assigneeIds: [financeManager.userId],
    })
    await harness.seedTask({ locationId, subjectId: budget.id, status: 'done' })
    // A task on another branch, in the same subject: the owner counts it, the branch manager
    // does not.
    await harness.seedTask({ locationId: other, subjectId: budget.id })

    const [ownerCard] = await listSubjects(owner, finance)
    expect(ownerCard?.openCount).toBe(2)
    expect(ownerCard?.doneCount).toBe(1)
    expect(ownerCard?.assignees.map((a) => a.id)).toEqual([financeManager.userId])
    expect(ownerCard?.assigneeOverflow).toBe(0)

    const [managerCard] = await listSubjects(financeManager.token, finance)
    expect(managerCard?.openCount).toBe(1)
    expect(managerCard?.doneCount).toBe(1)
  })

  // --- the three writes behind tasks.manageSubjects ---

  it('lets the owner create, rename and delete a subject, and refuses a manager all three', async () => {
    const created = await createSubject(owner, {
      departmentId: finance,
      name: 'Budget',
      description: 'Next year',
    })
    expect(created.statusCode).toBe(201)
    const subject = created.json<SubjectCard>()
    expect(subject.description).toBe('Next year')

    expect(
      (await createSubject(financeManager.token, { departmentId: finance, name: 'Mine' }))
        .statusCode,
    ).toBe(403)

    const renamed = await harness.app.inject({
      method: 'POST',
      url: `/tasks/subjects/${subject.id}/update`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: 'Budget 2027', description: null },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json<SubjectCard>().name).toBe('Budget 2027')
    expect(renamed.json<SubjectCard>().description).toBeNull()

    const managerRename = await harness.app.inject({
      method: 'POST',
      url: `/tasks/subjects/${subject.id}/update`,
      headers: { authorization: `Bearer ${financeManager.token}` },
      payload: { name: 'Nope', description: null },
    })
    expect(managerRename.statusCode).toBe(403)

    const managerDelete = await harness.app.inject({
      method: 'POST',
      url: `/tasks/subjects/${subject.id}/delete`,
      headers: { authorization: `Bearer ${financeManager.token}` },
    })
    expect(managerDelete.statusCode).toBe(403)

    const deleted = await harness.app.inject({
      method: 'POST',
      url: `/tasks/subjects/${subject.id}/delete`,
      headers: { authorization: `Bearer ${owner}` },
    })
    expect(deleted.statusCode).toBe(200)
    expect(await listSubjects(owner, finance)).toEqual([])
  })

  it('refuses a second subject that reads the same in one department', async () => {
    expect((await createSubject(owner, { departmentId: finance, name: 'Budget' })).statusCode).toBe(
      201,
    )
    const dup = await createSubject(owner, { departmentId: finance, name: '  budget ' })
    expect(dup.statusCode).toBe(409)
    expect(dup.json<{ error: string }>().error).toBe('duplicate_name')
    // The same name in another department is a different subject.
    expect(
      (await createSubject(owner, { departmentId: marketing, name: 'Budget' })).statusCode,
    ).toBe(201)
  })

  it('refuses to delete a subject that still holds work, and says how much', async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    await harness.seedTask({ locationId, subjectId: budget.id })
    await harness.seedTask({ locationId, subjectId: budget.id, status: 'done' })

    const res = await harness.app.inject({
      method: 'POST',
      url: `/tasks/subjects/${budget.id}/delete`,
      headers: { authorization: `Bearer ${owner}` },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'subject_in_use', taskCount: 2 })

    const missing = await harness.app.inject({
      method: 'POST',
      url: '/tasks/subjects/00000000-0000-4000-8000-000000000000/delete',
      headers: { authorization: `Bearer ${owner}` },
    })
    expect(missing.statusCode).toBe(404)
  })

  // --- filing a task ---

  it('requires a subject on a shared task and none on a private one', async () => {
    const bare = await createTask(owner, {})
    expect(bare.statusCode).toBe(400)

    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    const filed = await createTask(owner, { subjectId: budget.id })
    expect(filed.statusCode).toBe(201)
    expect(filed.json<{ subjectId: string | null }>().subjectId).toBe(budget.id)

    const personal = await createTask(financeManager.token, {
      personal: true,
      locationId: null,
      assigneeIds: [financeManager.userId],
    })
    expect(personal.statusCode).toBe(201)
    expect(personal.json<{ subjectId: string | null }>().subjectId).toBeNull()
  })

  it("refuses a subject outside the writer's department as one non-enumerating miss", async () => {
    const campaign = await harness.seedSubject({ departmentId: marketing, name: 'Campaign' })
    const res = await createTask(financeManager.token, { subjectId: campaign.id })
    expect(res.statusCode).toBe(404)
    // An id that names nothing reads the same.
    const ghost = await createTask(financeManager.token, {
      subjectId: '00000000-0000-4000-8000-000000000000',
    })
    expect(ghost.statusCode).toBe(404)
  })

  it('moves a task between subjects through the full edit, within the horizon', async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    const suppliers = await harness.seedSubject({ departmentId: finance, name: 'Suppliers' })
    const campaign = await harness.seedSubject({ departmentId: marketing, name: 'Campaign' })
    const created = await createTask(financeManager.token, { subjectId: budget.id })
    expect(created.statusCode).toBe(201)
    const taskId = created.json<{ id: string }>().id
    const edit = (subjectId: string | undefined) =>
      harness.app.inject({
        method: 'POST',
        url: `/tasks/${taskId}/update`,
        headers: { authorization: `Bearer ${financeManager.token}` },
        payload: {
          title: 'Task',
          description: null,
          priority: 'normal',
          dueDate: null,
          assigneeIds: [],
          ...(subjectId === undefined ? {} : { subjectId }),
        },
      })

    const moved = await edit(suppliers.id)
    expect(moved.statusCode).toBe(200)
    expect(moved.json<{ subjectId: string }>().subjectId).toBe(suppliers.id)

    // An edit that says nothing about the subject leaves the filing alone.
    const untouched = await edit(undefined)
    expect(untouched.json<{ subjectId: string }>().subjectId).toBe(suppliers.id)

    // Another department's subject is out of reach.
    expect((await edit(campaign.id)).statusCode).toBe(404)
  })

  // --- the board read the dashboard and the assistant share ---

  it("narrows the board to the viewer's department, and to nothing for an unplaced viewer", async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    const campaign = await harness.seedSubject({ departmentId: marketing, name: 'Campaign' })
    const financeTask = (await harness.seedTask({ locationId, subjectId: budget.id })).id
    const marketingTask = (await harness.seedTask({ locationId, subjectId: campaign.id })).id
    const privateNote = (
      await harness.seedTask({
        locationId: null,
        personal: true,
        createdBy: unplacedManager.userId,
        assigneeIds: [unplacedManager.userId],
      })
    ).id

    expect((await boardIds(owner)).sort()).toEqual([financeTask, marketingTask].sort())
    expect(await boardIds(financeManager.token)).toEqual([financeTask])
    // Unplaced: no shared work at all, but their own private note is still theirs.
    expect(await boardIds(unplacedManager.token)).toEqual([privateNote])
  })

  it('widens a role to every department when the owner moves the horizon to chain', async () => {
    const budget = await harness.seedSubject({ departmentId: finance, name: 'Budget' })
    const campaign = await harness.seedSubject({ departmentId: marketing, name: 'Campaign' })
    const financeTask = (await harness.seedTask({ locationId, subjectId: budget.id })).id
    const marketingTask = (await harness.seedTask({ locationId, subjectId: campaign.id })).id

    const flipped = await harness.app.inject({
      method: 'POST',
      url: '/access/scope',
      headers: { authorization: `Bearer ${owner}` },
      payload: { role: 'manager', key: 'tasks.departments', choice: 'chain' },
    })
    expect(flipped.statusCode).toBe(200)

    expect((await boardIds(financeManager.token)).sort()).toEqual(
      [financeTask, marketingTask].sort(),
    )
    expect((await listSubjects(financeManager.token, marketing)).map((s) => s.id)).toEqual([
      campaign.id,
    ])
  })

  // ── a branch's own subjects (owner ask 2026-09-20, evening; migration 0053) ──

  it('lets a branch admin see every department and file subjects under their branch, which the owner sees named and another branch never sees', async () => {
    const harbour = (await harness.seedLocation({ name: 'Harbour' })).id
    const downtownAdmin = await provision('adm-a@burgers.local', 'admin', finance)
    const harbourAdmin = await provision('adm-b@burgers.local', 'admin', finance, harbour)
    const harbourManager = await provision('mgr-b@burgers.local', 'manager', marketing, harbour)

    // Every department, though the admin sits in finance: their default horizon is the chain.
    const filed = await createSubject(downtownAdmin.token, {
      departmentId: marketing,
      name: 'Window posters',
    })
    expect(filed.statusCode).toBe(201)
    expect(filed.json<SubjectCard>()).toMatchObject({
      locationId,
      locationName: 'Downtown',
    })
    const chainWide = await createSubject(owner, { departmentId: marketing, name: 'Campaign' })
    expect(chainWide.json<SubjectCard>()).toMatchObject({ locationId: null, locationName: null })

    const names = async (token: string) =>
      (await listSubjects(token, marketing)).map((s) => s.name).sort()
    expect(await names(owner)).toEqual(['Campaign', 'Window posters'])
    expect(await names(downtownAdmin.token)).toEqual(['Campaign', 'Window posters'])
    expect(await names(harbourAdmin.token)).toEqual(['Campaign'])
    expect(await names(harbourManager.token)).toEqual(['Campaign'])
    // The by-id read draws the same line: Harbour asking for Downtown's subject learns nothing.
    const peek = await harness.app.inject({
      method: 'GET',
      url: `/tasks/subjects/${filed.json<SubjectCard>().id}`,
      headers: { authorization: `Bearer ${harbourAdmin.token}` },
    })
    expect(peek.statusCode).toBe(404)
  })

  it("lets a branch admin reshape only their branch's subjects, and the owner reshape all", async () => {
    const downtownAdmin = await provision('adm-a@burgers.local', 'admin', finance)
    const own = (
      await createSubject(downtownAdmin.token, { departmentId: finance, name: 'Petty cash' })
    ).json<SubjectCard>()
    const chain = await harness.seedSubject({ departmentId: finance, name: 'Budget' })

    const rename = (token: string, id: string, name: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/tasks/subjects/${id}/update`,
        headers: { authorization: `Bearer ${token}` },
        payload: { name, description: null },
      })
    expect((await rename(downtownAdmin.token, chain.id, 'Not mine')).statusCode).toBe(404)
    expect((await rename(downtownAdmin.token, own.id, 'Petty cash 2027')).statusCode).toBe(200)
    expect((await rename(owner, own.id, 'Petty cash (Downtown)')).statusCode).toBe(200)

    const remove = (token: string, id: string) =>
      harness.app.inject({
        method: 'POST',
        url: `/tasks/subjects/${id}/delete`,
        headers: { authorization: `Bearer ${token}` },
      })
    expect((await remove(downtownAdmin.token, chain.id)).statusCode).toBe(404)
    expect((await remove(downtownAdmin.token, own.id)).statusCode).toBe(200)
  })

  it("takes a branch's subject name again at another branch, but not twice at one", async () => {
    const harbour = (await harness.seedLocation({ name: 'Harbour' })).id
    const downtownAdmin = await provision('adm-a@burgers.local', 'admin', finance)
    const harbourAdmin = await provision('adm-b@burgers.local', 'admin', finance, harbour)
    await harness.seedSubject({ departmentId: finance, name: 'Budget' })

    expect(
      (await createSubject(downtownAdmin.token, { departmentId: finance, name: 'Budget' }))
        .statusCode,
    ).toBe(201)
    expect(
      (await createSubject(harbourAdmin.token, { departmentId: finance, name: 'budget' }))
        .statusCode,
    ).toBe(201)
    expect(
      (await createSubject(downtownAdmin.token, { departmentId: finance, name: ' budget ' }))
        .statusCode,
    ).toBe(409)
  })

  it("files a task under a branch's subject only when the task is on that branch", async () => {
    const harbour = (await harness.seedLocation({ name: 'Harbour' })).id
    const mine = await harness.seedSubject({
      departmentId: finance,
      locationId,
      name: 'Petty cash',
    })
    expect((await createTask(owner, { subjectId: mine.id, locationId: harbour })).statusCode).toBe(
      400,
    )
    expect((await createTask(owner, { subjectId: mine.id, locationId: null })).statusCode).toBe(400)
    expect((await createTask(owner, { subjectId: mine.id })).statusCode).toBe(201)
  })
})
