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

type Principal = typeof EMPLOYEE | typeof MANAGER

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
    task({ id: 'dddd0001-0000-0000-0000-000000000001', title: 'Manager task', priority: 'medium' }),
  ])
  await page.goto('/tasks')

  // The card's title opens the editor now (v2 handoff §4 — the overflow menu is gone), and the
  // editor sets status through the same StatusControl chip the card wears, not a select. Move it
  // to Done and save.
  await page.getByRole('button', { name: 'Manager task', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await dialog.getByRole('button', { name: 'To-do' }).click()
  await page.getByRole('menuitemradio', { name: 'Done' }).click()
  await dialog.getByRole('button', { name: 'Save changes' }).click()

  await expect.poll(() => board.updateBody()).toBeTruthy()
  expect((board.updateBody() as { status: string }).status).toBe('done')
})

// The pill sits at the inline-end of a card inside the shell's one scroll container, which on a
// phone is only 375px wide and stops at the tab bar — so the menu it opens has two edges it can
// fall off, and did on both (owner report 2026-08-16: the labels cut mid-word at the screen edge,
// and the last card's menu slid off-screen). Geometry, not appearance: the menu must sit inside
// the screen wherever on the board it is opened from.
test('on a phone the status menu stays inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await installBoard(
    page,
    EMPLOYEE,
    ['Prep the grill', 'Restock the cold line', 'Wipe the pass', 'Log the walk-in temperature'].map(
      (title, index) =>
        task({ id: `eeee0001-0000-0000-0000-00000000000${index + 1}`, title, position: index }),
    ),
  )
  await page.goto('/tasks')

  const cards = page.locator('article')
  await expect(cards).toHaveCount(4)
  // The phone board's lane tabs carry the same three status words as the pills, so each pill is
  // addressed through its own card rather than by name alone.
  const menu = page.getByRole('menu')

  for (const card of [cards.first(), cards.last()]) {
    await card.scrollIntoViewIfNeeded()
    await card.getByRole('button', { name: 'To-do' }).click()
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return
    // Inside the screen on both axes. The navigation rail is a column at the inline-start
    // since the v2 handoff (§7), so the menu clears it by starting after its width rather
    // than by sitting above a bottom bar.
    const rail = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
    expect(rail).not.toBeNull()
    if (rail) expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    await page.keyboard.press('Escape')
  }
})
