import { type Page, expect, test } from '@playwright/test'

// The task board Slice B write surface (#133), exercised against the built bundle with the session,
// the board read, the people read, and the write endpoints stubbed at the network edge (the same
// approach as tasks.spec.ts / shell.spec.ts). The scope model and the assignee-location invariant
// are proven end to end in the API integration suite; here we prove the browser surface: a manager
// creates, edits, and deletes through the UI (and the request it builds is the one the API expects),
// while an employee is shown no write controls at all.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'
// A branch with no staff in the people read — the case only the authoritative /locations list can
// surface, so an admin can open the first task on it (Slice L3).
const LOCATION_NEW = '99999999-9999-9999-9999-999999999999'

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: LOCATION_A,
  status: 'active',
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  displayName: 'Yael Bar',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
} as const

const OWNER = {
  userId: '44444444-4444-4444-4444-444444444444',
  displayName: 'Shahar Adler',
  role: 'super_admin',
  locationId: null,
  status: 'active',
} as const

type Principal = typeof EMPLOYEE | typeof MANAGER | typeof OWNER

// The authoritative Location list the admin task-form picker reads (GET /locations, Slice L3):
// the manager's staffed branch and a brand-new, unstaffed one — the latter impossible to reach
// from the old people-derived list.
const LOCATIONS = [
  { id: LOCATION_A, name: 'Downtown' },
  { id: LOCATION_NEW, name: 'New Branch' },
]

interface StubTask {
  id: string
  locationId: string
  title: string
  description: string | null
  status: 'not_started' | 'in_progress' | 'done'
  priority: 'normal' | 'medium' | 'high'
  dueDate: string | null
  completedAt: string | null
  position: number
  assignees: { id: string; displayName: string }[]
  createdBy: { id: string; displayName: string }
}

const STAMP = '2026-01-01T00:00:00.000Z'

function wire(t: StubTask) {
  // assignedAt is filled at the wire edge (#136) so factory call sites stay terse; SSE frames
  // must carry it or the SPA's zod parse drops them.
  return {
    ...t,
    assignees: t.assignees.map((assignee) => ({ assignedAt: STAMP, ...assignee })),
    createdAt: STAMP,
    updatedAt: STAMP,
  }
}

function boardResponse(tasks: StubTask[]) {
  return {
    tasks: [...tasks].sort((a, b) => a.position - b.position).map(wire),
    lastSeenAt: null,
  }
}

// Two active people at the manager's location, so the assignee picker has real candidates. The
// people read (GET /users) is already location-scoped server-side; the form narrows to the location.
const PEOPLE_A = [
  {
    id: 'aaaa0001-0000-0000-0000-000000000001',
    email: 'dana@burgers.local',
    displayName: 'Dana',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'aaaa0002-0000-0000-0000-000000000002',
    email: 'noa@burgers.local',
    displayName: 'Noa',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  },
]

interface BoardHandle {
  createBody: () => Record<string, unknown> | undefined
  updateBody: () => Record<string, unknown> | undefined
  deleted: () => boolean
}

// Install the session and every route the board write surface touches over one mutable task list, so
// a create/edit/delete reflects on the next board read exactly as the real invalidate-and-refetch
// would. Returns handles onto the requests the UI issued, so a case can assert the exact body sent.
async function installBoard(
  page: Page,
  principal: Principal,
  initial: StubTask[],
): Promise<BoardHandle> {
  const tasks = [...initial]
  let createBody: Record<string, unknown> | undefined
  let updateBody: Record<string, unknown> | undefined
  let deleted = false

  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: PEOPLE_A } }))
  await page.route('**/tasks/stream*', (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' }),
  )

  // The by-id writes: register before the general /tasks route. Each mutates the shared list so the
  // follow-up board read (the UI invalidates and refetches on success) shows the result.
  await page.route('**/tasks/*/update', (route) => {
    updateBody = route.request().postDataJSON()
    const id = route.request().url().split('/tasks/')[1].split('/update')[0]
    const index = tasks.findIndex((t) => t.id === id)
    if (index !== -1) {
      const b = updateBody as {
        title: string
        description: string | null
        priority: StubTask['priority']
        dueDate: string | null
        assigneeIds: string[]
      }
      tasks[index] = {
        ...tasks[index],
        title: b.title,
        description: b.description,
        priority: b.priority,
        dueDate: b.dueDate,
        assignees: b.assigneeIds.map((uid) => ({
          id: uid,
          displayName: PEOPLE_A.find((p) => p.id === uid)?.displayName ?? uid,
        })),
      }
    }
    return route.fulfill({ json: wire(tasks[index]) })
  })
  await page.route('**/tasks/*/delete', (route) => {
    deleted = true
    const id = route.request().url().split('/tasks/')[1].split('/delete')[0]
    const index = tasks.findIndex((t) => t.id === id)
    if (index !== -1) tasks.splice(index, 1)
    return route.fulfill({ json: { status: 'ok' } })
  })

  // The board read always peeks (#136), so it matches on the query string; the bare /tasks route
  // below keeps serving the POST create. The seen report the screen sends on mount/unmount is
  // acknowledged so it never leaves the stub world.
  await page.route('**/tasks?peek=1', (route) => route.fulfill({ json: boardResponse(tasks) }))
  await page.route('**/tasks/seen', (route) => route.fulfill({ json: { lastSeenAt: STAMP } }))
  await page.route('**/tasks', (route) => {
    const request = route.request()
    if (request.resourceType() === 'document') return route.continue()
    if (request.method() === 'POST') {
      createBody = request.postDataJSON()
      const b = createBody as {
        title: string
        description: string | null
        priority: StubTask['priority']
        dueDate: string | null
        assigneeIds: string[]
        locationId: string | null
      }
      const created: StubTask = {
        id: 'ffff0001-0000-0000-0000-000000000001',
        // A manager sends null (their own location is used server-side); an admin sends the chosen
        // board. Reflect what was sent so the created card lands on the right branch.
        locationId: b.locationId ?? LOCATION_A,
        // The API records the acting principal as creator (#258); the stub mirrors that shape.
        createdBy: { id: principal.userId, displayName: 'Acting Principal' },
        title: b.title,
        description: b.description,
        status: 'not_started',
        priority: b.priority,
        dueDate: b.dueDate,
        completedAt: null,
        position: 100,
        assignees: b.assigneeIds.map((uid) => ({
          id: uid,
          displayName: PEOPLE_A.find((p) => p.id === uid)?.displayName ?? uid,
        })),
      }
      tasks.push(created)
      return route.fulfill({ status: 201, json: wire(created) })
    }
    return route.fulfill({ json: boardResponse(tasks) })
  })

  return {
    createBody: () => createBody,
    updateBody: () => updateBody,
    deleted: () => deleted,
  }
}

function task(overrides: Partial<StubTask> & Pick<StubTask, 'id' | 'title'>): StubTask {
  return {
    locationId: LOCATION_A,
    description: null,
    status: 'not_started',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    position: 0,
    createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'Maya Manager' },
    assignees: [],
    ...overrides,
  }
}

test('an employee sees no write controls on the board', async ({ page }) => {
  await installBoard(page, EMPLOYEE, [
    task({
      id: 'eeee0001-0000-0000-0000-000000000001',
      title: 'Prep the grill',
      assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana' }],
    }),
  ])
  await page.goto('/tasks')

  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toBeVisible()
  // No create affordance, and no way into the editor at all — edit and delete are the manager
  // surface. The employee's one write is the StatusControl pill (#223), proven in
  // tasks-status.spec.ts.
  await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prep the grill', exact: true })).toHaveCount(0)
  // Opening the status pill offers only the three status radios — no edit, no delete.
  await page.getByRole('button', { name: 'To-do' }).click()
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
  await expect(page.getByRole('menuitemradio')).toHaveCount(3)
})

test('a manager creates and assigns a task through the form', async ({ page }) => {
  const board = await installBoard(page, MANAGER, [])
  await page.goto('/tasks')

  // An empty board shows two "New task" affordances now (#213): the header action and the
  // empty-state CTA. Open the form from the header one (first in the DOM); both open the sheet.
  await page.getByRole('button', { name: 'New task' }).first().click()
  // On desktop the form opens as the inline-end drawer — a modal dialog over the board (#215).
  const sheet = page.getByRole('dialog', { name: 'New task' })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Title').fill('Deep clean the fryer')
  // Priority is the DS listbox Select now, not a native <select>: open it and pick the option.
  await sheet.getByLabel('Priority').click()
  await page.getByRole('option', { name: 'High' }).click()
  // Assignees is a dropdown of checkbox rows now (2026-08-21): open it, tick Dana, and close
  // it with Escape — which must dismiss the MENU alone, never the dialog behind it.
  await sheet.getByRole('button', { name: 'Assignees' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dana' }).click()
  await page.keyboard.press('Escape')
  await sheet.getByRole('button', { name: 'Create task' }).click()

  // The request the UI built is exactly what the API expects: a manager sends no location (their own
  // is used server-side), the chosen priority, and the checked assignee.
  await expect.poll(() => board.createBody()).toBeTruthy()
  const body = board.createBody() as {
    title: string
    priority: string
    assigneeIds: string[]
    locationId: string | null
  }
  expect(body.title).toBe('Deep clean the fryer')
  expect(body.priority).toBe('high')
  expect(body.assigneeIds).toEqual([PEOPLE_A[0].id])
  expect(body.locationId).toBeNull()

  // On success the form closes (the create button returns) and the new card is on the board.
  await expect(page.getByRole('heading', { name: 'Deep clean the fryer' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New task' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(0)
})

test('the chain owner opens the first task on a brand-new, unstaffed branch from the Location picker', async ({
  page,
}) => {
  const board = await installBoard(page, OWNER, [])
  // The owner's picker reads the authoritative Location list, not the distinct ids in the people list.
  await page.route('**/locations', (route) => route.fulfill({ json: { locations: LOCATIONS } }))
  await page.goto('/tasks')

  // Empty board → header New task and the empty-state CTA both present; open from the header.
  await page.getByRole('button', { name: 'New task' }).first().click()
  const sheet = page.getByRole('dialog', { name: 'New task' })
  await sheet.getByLabel('Title').fill('Stock the new branch')

  // The Location picker is the DS listbox Select (owner-on-create only: a branch admin's board
  // is implied by the branch they hold, so they are never asked). Opening it offers the
  // brand-new branch — a Location with no staff yet, which the old people-derived list could
  // never surface. Choose it by name.
  await sheet.getByLabel('Location', { exact: true }).click()
  await expect(page.getByRole('option', { name: 'New Branch' })).toHaveCount(1)
  await page.getByRole('option', { name: 'New Branch' }).click()

  // An unstaffed branch has no one to assign — the assignee empty-state states it plainly.
  await expect(sheet.getByText('No one at this location to assign yet.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Create task' }).click()

  // The owner sends the chosen board id and no assignees — a task can be opened on a branch
  // before anyone works there.
  await expect.poll(() => board.createBody()).toBeTruthy()
  const body = board.createBody() as {
    title: string
    locationId: string | null
    assigneeIds: string[]
  }
  expect(body.title).toBe('Stock the new branch')
  expect(body.locationId).toBe(LOCATION_NEW)
  expect(body.assigneeIds).toEqual([])

  await expect(page.getByRole('heading', { name: 'Stock the new branch' })).toBeVisible()
})

test('changing the Location clears the picked assignees (the assignee-location invariant)', async ({
  page,
}) => {
  const board = await installBoard(page, OWNER, [])
  await page.route('**/locations', (route) => route.fulfill({ json: { locations: LOCATIONS } }))
  await page.goto('/tasks')

  await page.getByRole('button', { name: 'New task' }).first().click()
  const sheet = page.getByRole('dialog', { name: 'New task' })
  await sheet.getByLabel('Title').fill('Cross-branch guard')

  // Pick the staffed branch and check Dana, then switch to a different branch. The switch must
  // clear the pick — a stale cross-location assignee would be rejected by the server invariant.
  await sheet.getByLabel('Location', { exact: true }).click()
  await page.getByRole('option', { name: 'Downtown' }).click()
  await sheet.getByRole('button', { name: 'Assignees' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Dana' }).click()
  await page.keyboard.press('Escape')
  await sheet.getByLabel('Location', { exact: true }).click()
  await page.getByRole('option', { name: 'New Branch' }).click()
  await sheet.getByRole('button', { name: 'Create task' }).click()

  // The created task lands on the new branch with no assignees — the checked Dana was cleared by
  // the switch, not silently carried across.
  await expect.poll(() => board.createBody()).toBeTruthy()
  const body = board.createBody() as { locationId: string | null; assigneeIds: string[] }
  expect(body.locationId).toBe(LOCATION_NEW)
  expect(body.assigneeIds).toEqual([])
})

test('the desktop search filters the board by title and states when nothing matches', async ({
  page,
}) => {
  await installBoard(page, MANAGER, [
    task({ id: 'ssss0001-0000-0000-0000-000000000001', title: 'Clean the grill' }),
    task({ id: 'ssss0002-0000-0000-0000-000000000002', title: 'Restock the buns' }),
  ])
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Clean the grill' })).toBeVisible()

  // A case-insensitive title filter narrows the board to matches; the other card leaves.
  const search = page.getByRole('searchbox', { name: 'Search tasks' })
  await search.fill('grill')
  await expect(page.getByRole('heading', { name: 'Clean the grill' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Restock the buns' })).toHaveCount(0)

  // A term that matches nothing on a non-empty board shows a plain line, not the empty state.
  await search.fill('nothing here')
  await expect(page.getByText('No tasks match your search.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Clean the grill' })).toHaveCount(0)
})

test('a manager edits a task through the full-update form', async ({ page }) => {
  const board = await installBoard(page, MANAGER, [
    task({
      id: 'dddd0001-0000-0000-0000-000000000001',
      title: 'Draft title',
      priority: 'medium',
      assignees: [{ id: PEOPLE_A[0].id, displayName: 'Dana' }],
    }),
  ])
  await page.goto('/tasks')

  // The card's own title opens the editor (v2 handoff §4).
  await page.getByRole('button', { name: 'Draft title', exact: true }).click()
  // The dialog opens pre-filled; change the title and save. Scope to the dialog's textbox: the
  // seeded card's drag handle is labelled "Reorder Draft title", which would also match by label.
  const sheet = page.getByRole('dialog', { name: 'Edit task' })
  // Provenance rides the editor (#258): the stubbed task's creator renders read-only, now as a
  // row of the property grid.
  await expect(sheet.getByText('Maya Manager')).toBeVisible()
  const title = sheet.getByRole('textbox', { name: 'Title' })
  await expect(title).toHaveValue('Draft title')
  await title.fill('Final title')
  await sheet.getByRole('button', { name: 'Save changes' }).click()

  await expect.poll(() => board.updateBody()).toBeTruthy()
  expect((board.updateBody() as { title: string }).title).toBe('Final title')
  await expect(page.getByRole('heading', { name: 'Final title' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Draft title' })).toHaveCount(0)
})

test('a manager deletes a task after confirming', async ({ page }) => {
  const board = await installBoard(page, MANAGER, [
    task({
      id: 'cccc0001-0000-0000-0000-000000000001',
      title: 'Task to remove',
      assignees: [{ id: PEOPLE_A[0].id, displayName: 'Dana' }],
    }),
  ])
  await page.goto('/tasks')

  // Delete lives in the editor's footer and routes through an AlertDialog: opening the task and
  // pressing Delete opens the confirm, whose destructive Delete commits it.
  await page.getByRole('button', { name: 'Task to remove', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Edit task' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByText('Delete this task?')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()

  await expect.poll(() => board.deleted()).toBe(true)
  // The board refetch after the delete no longer carries the task.
  await expect(page.getByRole('heading', { name: 'Task to remove' })).toHaveCount(0)
})

test('a manager creates a task from the mobile Create FAB and its bottom sheet', async ({
  page,
}) => {
  // A phone viewport: the desktop content-header's New task is hidden and the board owns the
  // Create FAB (#215/#207). Seed one task so the empty-state CTA is absent — the FAB is then the
  // only "New task" affordance, which is exactly what we mean to exercise.
  await page.setViewportSize({ width: 390, height: 844 })
  const board = await installBoard(page, MANAGER, [
    task({ id: 'bbbb0001-0000-0000-0000-000000000001', title: 'Existing task' }),
  ])
  await page.goto('/tasks')

  // The FAB opens the same TaskFormSheet — here the mobile bottom sheet.
  await page.getByRole('button', { name: 'New task' }).click()
  const sheet = page.getByRole('dialog', { name: 'New task' })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Title').fill('Wipe the tables')
  await sheet.getByRole('button', { name: 'Create task' }).click()

  await expect.poll(() => board.createBody()).toBeTruthy()
  expect((board.createBody() as { title: string }).title).toBe('Wipe the tables')
  await expect(page.getByRole('heading', { name: 'Wipe the tables' })).toBeVisible()
})

test('a manager deletes a task from the edit sheet after confirming', async ({ page }) => {
  const board = await installBoard(page, MANAGER, [
    task({
      id: 'aaaa0003-0000-0000-0000-000000000003',
      title: 'Remove from sheet',
      assignees: [{ id: PEOPLE_A[0].id, displayName: 'Dana' }],
    }),
  ])
  await page.goto('/tasks')

  // The same path from the list's own row: open the task, then use the editor's footer Delete.
  await page.getByRole('button', { name: 'Remove from sheet', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Edit task' })
  await sheet.getByRole('button', { name: 'Delete' }).click()

  // The confirm dialog opens over the sheet; its destructive Delete commits it.
  const confirm = page.getByRole('alertdialog')
  await expect(confirm.getByText('Delete this task?')).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete' }).click()

  await expect.poll(() => board.deleted()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Remove from sheet' })).toHaveCount(0)
})
