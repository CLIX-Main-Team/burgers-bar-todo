import { capabilitiesFor } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The task board Slice A read (#131), exercised against the built bundle with the session and the
// board read stubbed at the network edge (the same approach as shell.spec.ts). The scope predicate
// itself is proven in the API integration suite; here we prove the UI faithfully renders each
// role's already-scoped board — an employee's own task with no backlog, a manager's location board
// with the backlog, an admin's chain-wide board — and that the priority sort is a view-only lens
// over the shared order.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'
const LOCATION_B = '44444444-4444-4444-4444-444444444444'

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: LOCATION_A,
  status: 'active',
  capabilities: capabilitiesFor('employee'),
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  displayName: 'Yael Bar',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
  capabilities: capabilitiesFor('manager'),
} as const

const OWNER = {
  userId: '55555555-5555-5555-5555-555555555555',
  displayName: 'Shahar Adler',
  role: 'super_admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('admin'),
} as const

type Principal = typeof EMPLOYEE | typeof MANAGER | typeof OWNER

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
  // Required on the wire since projects landed, and the live channel PARSES rather than tolerates:
  // a frame missing this field throws in board-stream and the upsert is dropped in silence.
  projectId: string | null
  // Required on the wire since private tasks landed (2026-08-25): the board splits its two tabs
  // on this field, so a stub without it puts every task on neither.
  personal: boolean
  checklist: []
  assignees: { id: string; displayName: string }[]
  // Required on the wire since checklists landed (2026-08-26). The card and the list row read
  // `task.checklist.length`, so a stub without it throws where the board renders, not where the
  // stub is written — and e2e sits outside tsc, so nothing catches it earlier.
  checklist: { id: string; title: string; done: boolean; position: number; assignees: never[] }[]
  createdBy: { id: string; displayName: string }
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
    projectId: null,
    personal: false,
    createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'Maya Manager' },
    checklist: [],
    assignees: [],
    ...overrides,
  }
}

// The board response the API returns, already scoped: the tasks come in the shared manual order
// (position ascending), which the caller receives verbatim. createdAt/updatedAt — and each
// assignee's assignedAt (#136) — are filled in here so the payload matches the wire shape the SPA
// renders.
function boardResponse(tasks: StubTask[]) {
  return {
    tasks: [...tasks].sort((a, b) => a.position - b.position).map(wireTask),
    lastSeenAt: null,
  }
}

// The wire shape of a single task the SSE channel delivers: the board's task plus the timestamps
// the read fills in, matching taskSchema so the SPA's cache patch validates it — assignedAt
// included, or the zod parse drops the frame.
function wireTask(t: StubTask) {
  const stamp = '2026-01-01T00:00:00.000Z'
  return {
    ...t,
    assignees: t.assignees.map((assignee) => ({ assignedAt: stamp, ...assignee })),
    createdAt: stamp,
    updatedAt: stamp,
  }
}

// One `task.upserted` frame as the live channel emits it (#132): a `data:` line carrying the event,
// terminated by the blank line SSE uses to end a frame.
function upsertFrame(t: StubTask): string {
  return `data: ${JSON.stringify({ type: 'task.upserted', task: wireTask(t) })}\n\n`
}

// Seed the bearer so the session provider issues its /auth/me read, fulfil that read with the
// principal, and fulfil the board read with the given payload. The board route filters on resource
// type so the SPA's own document load at /tasks still passes through — only the XHR is stubbed. The
// live channel (/tasks/stream) is stubbed silent by default so the board's EventSource has
// something to connect to; a case that exercises realtime overrides it with its own frames.
async function stubBoard(
  page: Page,
  principal: Principal,
  board: ReturnType<typeof boardResponse>,
) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/tasks/stream*', (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' }),
  )
  // The board read always peeks (#136), so the query string is part of the matched URL; the seen
  // report the screen sends on mount/unmount is acknowledged so it never leaves the stub world.
  await page.route('**/tasks?peek=1', (route) => route.fulfill({ json: board }))
  await page.route('**/tasks/seen', (route) =>
    route.fulfill({ json: { lastSeenAt: '2026-01-01T00:00:00.000Z' } }),
  )
}

test('an employee sees only their own assigned task — no backlog on the board', async ({
  page,
}) => {
  await stubBoard(
    page,
    EMPLOYEE,
    boardResponse([
      task({
        id: 'aaaaaaa1-0000-0000-0000-000000000001',
        title: 'Prep the grill',
        description: 'לסדר את המקרר לפני הפתיחה',
        status: 'in_progress',
        priority: 'high',
        position: 10,
        checklist: [],
        assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana' }],
      }),
    ]),
  )
  await page.goto('/tasks')

  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toBeVisible()
  // The description does NOT render on the card (owner call 2026-08-23, reversing the
  // 2026-08-12 recut): it belongs to the task you open, not to the lane you scan.
  await expect(page.getByText('לסדר את המקרר לפני הפתיחה')).toHaveCount(0)
  // The card carries no standalone status chip (#213): the lane will name the status once the
  // kanban lands, and a done card is the one status the card still shows on its own.
  // High priority leads with the warning glyph so urgent cards stand out at a scan (#161); the
  // chip's own 'High' label still names the priority, so the glyph is decorative.
  await expect(page.locator('span', { hasText: 'High' }).locator('svg')).toHaveCount(1)
  // An employee's board never carries the backlog.
  await expect(page.getByText('Backlog')).toHaveCount(0)
})

test("a manager sees their location's board including the backlog", async ({ page }) => {
  await stubBoard(
    page,
    MANAGER,
    boardResponse([
      task({
        id: 'bbbbbbb1-0000-0000-0000-000000000001',
        title: 'Prep the grill',
        priority: 'high',
        position: 30,
        checklist: [],
        assignees: [{ id: 'x', displayName: 'Dana' }],
      }),
      task({
        id: 'bbbbbbb2-0000-0000-0000-000000000002',
        title: 'Close the register',
        priority: 'normal',
        status: 'done',
        completedAt: new Date('2026-01-05T12:00:00.000Z').toISOString(),
        position: 20,
        checklist: [],
        assignees: [{ id: 'y', displayName: 'Noa' }],
      }),
      // The backlog: a task with no assignees, which a manager sees and an employee never does.
      task({
        id: 'bbbbbbb3-0000-0000-0000-000000000003',
        title: 'Restock napkins',
        priority: 'medium',
        position: 10,
        checklist: [],
        assignees: [],
      }),
    ]),
  )
  await page.goto('/tasks')

  await expect(page.getByRole('heading', { name: 'Restock napkins' })).toBeVisible()
  await expect(page.getByText('Backlog')).toBeVisible()
  // A raised priority wears the flag pill — medium included (2026-08-21 recolour).
  await expect(page.locator('span', { hasText: 'Medium' }).locator('svg')).toHaveCount(1)
  // Normal priority renders no chip at all — the implicit default is omitted to cut board noise
  // (#161, components.md §Badge). 'Close the register' is the normal-priority task.
  await expect(page.getByText('Normal', { exact: true })).toHaveCount(0)
})

test('the chain owner sees tasks across locations including the backlog', async ({ page }) => {
  await stubBoard(
    page,
    OWNER,
    boardResponse([
      task({
        id: 'ccccccc1-0000-0000-0000-000000000001',
        title: 'Prep the grill',
        locationId: LOCATION_A,
        position: 10,
        checklist: [],
        assignees: [{ id: 'x', displayName: 'Dana' }],
      }),
      task({
        id: 'ccccccc2-0000-0000-0000-000000000002',
        title: 'Sweep the patio',
        locationId: LOCATION_B,
        position: 20,
        checklist: [],
        assignees: [{ id: 'z', displayName: 'Omar' }],
      }),
      task({
        id: 'ccccccc3-0000-0000-0000-000000000003',
        title: 'Restock napkins',
        locationId: LOCATION_B,
        position: 30,
        checklist: [],
        assignees: [],
      }),
    ]),
  )
  await page.goto('/tasks')

  // Both locations' tasks and the backlog are on the one board.
  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sweep the patio' })).toBeVisible()
  await expect(page.getByText('Backlog')).toBeVisible()
})

test('the priority sort is a view-only lens with a stable tiebreak', async ({ page }) => {
  await stubBoard(
    page,
    MANAGER,
    boardResponse([
      // Positions run counter to priority so the manual order and the priority order differ, and
      // two tasks share the 'normal' priority so the sort's stable tiebreak has something to prove.
      task({
        id: 'ddddddd1-0000-0000-0000-000000000001',
        title: 'High priority',
        priority: 'high',
        position: 40,
        checklist: [],
        assignees: [{ id: 'x', displayName: 'Dana' }],
      }),
      task({
        id: 'ddddddd2-0000-0000-0000-000000000002',
        title: 'Normal A',
        priority: 'normal',
        position: 10,
        checklist: [],
        assignees: [{ id: 'y', displayName: 'Noa' }],
      }),
      task({
        id: 'ddddddd3-0000-0000-0000-000000000003',
        title: 'Normal B',
        priority: 'normal',
        position: 20,
        checklist: [],
        assignees: [{ id: 'z', displayName: 'Omar' }],
      }),
      task({
        id: 'ddddddd4-0000-0000-0000-000000000004',
        title: 'Medium priority',
        priority: 'medium',
        position: 30,
        checklist: [],
        assignees: [],
      }),
    ]),
  )
  await page.goto('/tasks')

  const titles = page.getByRole('heading', { level: 3 })
  // Opens to the shared manual order (position ascending), not priority.
  await expect(titles).toHaveText(['Normal A', 'Normal B', 'Medium priority', 'High priority'])

  // Turning the sort on re-orders the view high→low, without any server round trip. The two
  // 'normal' tasks keep their manual order (Normal A before Normal B) — the stable tiebreak.
  await page.getByRole('button', { name: 'Sort by priority' }).click()
  await expect(titles).toHaveText(['High priority', 'Medium priority', 'Normal A', 'Normal B'])

  // Turning it off restores the shared manual order — the sort never rewrote anything.
  await page.getByRole('button', { name: 'Manual order' }).click()
  await expect(titles).toHaveText(['Normal A', 'Normal B', 'Medium priority', 'High priority'])
})

test('a streamed change patches the board in place, without a refetch', async ({ page }) => {
  const original = task({
    id: 'fffffff1-0000-0000-0000-000000000001',
    title: 'Prep the grill',
    status: 'not_started',
    position: 10,
    checklist: [],
    assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana' }],
  })
  await stubBoard(page, EMPLOYEE, boardResponse([original]))

  // Re-serve the board read, but flag when it lands: the cache must hold the board before the
  // stream patch arrives, or the SPA (which never fabricates a board from a lone event) drops it.
  let boardServed = false
  await page.route('**/tasks?peek=1', (route) => {
    boardServed = true
    return route.fulfill({ json: boardResponse([original]) })
  })

  // The same task, changed: a new title and a done status — exactly the kind of upsert slices C/D
  // will emit. It carries the identical id, so the cache patch replaces the card in place.
  const changed: StubTask = {
    ...original,
    title: 'Grill is prepped',
    status: 'done',
    completedAt: '2026-01-05T12:00:00.000Z',
  }
  await page.route('**/tasks/stream*', async (route) => {
    while (!boardServed) await new Promise((resolve) => setTimeout(resolve, 20))
    await route.fulfill({
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: upsertFrame(changed),
    })
  })

  await page.goto('/tasks')

  // The streamed upsert replaces the task in place — new title, done status — with no navigation and
  // no board refetch (the board query has refetchOnWindowFocus off; the channel is what keeps it
  // fresh). The old title is gone because the same task id was replaced, not appended.
  await expect(page.getByRole('heading', { name: 'Grill is prepped' })).toBeVisible()
  // A done card shows its completed time in place of the due date (#213) — the visible signal
  // that the streamed upsert flipped the status to done (there is no standalone status chip).
  await expect(page.getByText(/Completed/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toHaveCount(0)
})

test('the board is right-to-left aware in Hebrew', async ({ page }) => {
  await stubBoard(
    page,
    EMPLOYEE,
    boardResponse([
      task({
        id: 'eeeeeee1-0000-0000-0000-000000000001',
        title: 'Prep the grill',
        position: 10,
        checklist: [],
        assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana' }],
      }),
    ]),
  )
  await page.goto('/tasks')

  const html = page.locator('html')
  await expect(html).toHaveAttribute('dir', 'ltr')

  // Flip to Hebrew from the account menu; the whole document (board included) flips to RTL.
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(html).toHaveAttribute('dir', 'rtl')
  await expect(html).toHaveAttribute('lang', 'he')
})
