import { type Page, expect, test } from '@playwright/test'

// The task board Slice C status write (#134), exercised against the built bundle with the session,
// the board read, and the status write stubbed at the network edge (the same approach as
// tasks-writes.spec.ts). The scope model — who may move which task — is proven end to end in the API
// integration suite; here we prove the browser surface: an employee, whose board is otherwise
// read-only, moves a task's status through the one control they have and the request it builds is the
// one the API expects; and a manager moves status through the full edit form.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'employee',
  locationId: LOCATION_A,
  status: 'active',
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
} as const

type Principal = typeof EMPLOYEE | typeof MANAGER

interface StubTask {
  id: string
  locationId: string
  title: string
  description: string | null
  status: 'not_started' | 'in_progress' | 'done'
  priority: 'low' | 'normal' | 'high'
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

// A manager form narrows its assignee choices to the location's active people; the status test needs
// one so the edit form opens with a candidate. An employee never sees this read (canWrite is false).
const PEOPLE_A = [
  {
    id: EMPLOYEE.userId,
    email: 'dana@burgers.local',
    displayName: 'Dana',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  },
]

interface BoardHandle {
  statusBody: () => Record<string, unknown> | undefined
  updateBody: () => Record<string, unknown> | undefined
}

// Install the session, the board read, and the two writes that can move status (the dedicated status
// path and the full-update path) over one mutable task list, so a change reflects on the next board
// read exactly as the real invalidate-and-refetch would. The trigger's completed_at is mimicked so a
// done task carries a stamp, matching what the API would return.
async function installBoard(
  page: Page,
  principal: Principal,
  initial: StubTask[],
): Promise<BoardHandle> {
  const tasks = [...initial]
  let statusBody: Record<string, unknown> | undefined
  let updateBody: Record<string, unknown> | undefined

  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: PEOPLE_A } }))
  await page.route('**/tasks/stream*', (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' }),
  )

  await page.route('**/tasks/*/status', (route) => {
    statusBody = route.request().postDataJSON()
    const id = route.request().url().split('/tasks/')[1].split('/status')[0]
    const index = tasks.findIndex((t) => t.id === id)
    const status = (statusBody as { status: StubTask['status'] }).status
    if (index !== -1) {
      // Mirror the DB trigger: entering done stamps completed_at, leaving it clears the stamp.
      tasks[index] = {
        ...tasks[index],
        status,
        completedAt: status === 'done' ? STAMP : null,
      }
    }
    return route.fulfill({ json: wire(tasks[index]) })
  })
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
        status?: StubTask['status']
      }
      const status = b.status ?? tasks[index].status
      tasks[index] = {
        ...tasks[index],
        title: b.title,
        description: b.description,
        priority: b.priority,
        dueDate: b.dueDate,
        status,
        completedAt: status === 'done' ? STAMP : null,
        assignees: b.assigneeIds.map((uid) => ({
          id: uid,
          displayName: PEOPLE_A.find((p) => p.id === uid)?.displayName ?? uid,
        })),
      }
    }
    return route.fulfill({ json: wire(tasks[index]) })
  })

  // The board read always peeks (#136), so the query string is part of the matched URL; the seen
  // report the screen sends on mount/unmount is acknowledged so it never leaves the stub world.
  await page.route('**/tasks?peek=1', (route) => route.fulfill({ json: boardResponse(tasks) }))
  await page.route('**/tasks/seen', (route) => route.fulfill({ json: { lastSeenAt: STAMP } }))

  return {
    statusBody: () => statusBody,
    updateBody: () => updateBody,
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
    assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana' }],
    ...overrides,
  }
}

test('an employee moves a task through the status control', async ({ page }) => {
  const board = await installBoard(page, EMPLOYEE, [
    task({ id: 'eeee0001-0000-0000-0000-000000000001', title: 'Prep the grill' }),
  ])
  await page.goto('/tasks')

  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toBeVisible()
  // The employee's one write is now the always-visible StatusControl pill (#223): the pill names
  // the current status and opens a menu of the three, the current one the checked radio. No edit
  // affordance — that is the manager surface.
  await page.getByRole('button', { name: 'To-do' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'To-do' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0)

  await page.getByRole('menuitemradio', { name: 'Done' }).click()

  // The request the UI built carries only the status — the dedicated status body, nothing else.
  await expect.poll(() => board.statusBody()).toBeTruthy()
  expect(board.statusBody()).toEqual({ status: 'done' })

  // On success the board refetches; the pill now reads Done, and reopening shows Done checked.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Done' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('a manager moves status through the full edit form', async ({ page }) => {
  const board = await installBoard(page, MANAGER, [
    task({ id: 'dddd0001-0000-0000-0000-000000000001', title: 'Manager task', priority: 'low' }),
  ])
  await page.goto('/tasks')

  // Edit lives in the card's overflow menu now (#213) and opens the TaskFormSheet (#215); the full
  // edit form still carries the Status field (story 43), now the DS listbox Select. Move it to Done
  // and save.
  await page.getByRole('button', { name: 'Actions for Manager task' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const sheet = page.getByRole('dialog', { name: 'Edit task' })
  await sheet.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Done' }).click()
  await sheet.getByRole('button', { name: 'Save changes' }).click()

  await expect.poll(() => board.updateBody()).toBeTruthy()
  expect((board.updateBody() as { status: string }).status).toBe('done')
})
