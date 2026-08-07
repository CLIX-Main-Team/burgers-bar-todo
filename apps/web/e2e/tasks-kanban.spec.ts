import { type Locator, type Page, expect, test } from '@playwright/test'

// The flagship 3-column status kanban and its two drag reinterpretations (#214), exercised against
// the built bundle with the session, the board read, and the two drag writes stubbed at the network
// edge (the same approach as tasks-writes.spec.ts). The scope model is proven end to end in the API
// integration suite; here we prove the browser surface: a manager drags a card *across* lanes and it
// sets status through the status endpoint, and drags a card *within* a lane and it reorders through
// the existing position endpoint — each optimistically, each carrying the exact request the API
// expects.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
} as const

const TASK_A = 'aaaa0001-0000-0000-0000-000000000001'
const TASK_B = 'bbbb0002-0000-0000-0000-000000000002'

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
    // Assigned so the card is never the backlog and the manager board renders the reorder grip.
    assignees: [{ id: 'staff-1', displayName: 'Dana' }],
    ...overrides,
  }
}

interface BoardHandle {
  statusBody: () => Record<string, unknown> | undefined
  reorderBody: () => Record<string, unknown> | undefined
}

// Install the session and the routes the kanban touches over one mutable task list, so a drag that
// invalidates (the status move refetches on settle) reflects on the next board read. Returns handles
// onto the two write bodies so a case can assert the exact request the drag built.
async function installBoard(page: Page, initial: StubTask[]): Promise<BoardHandle> {
  const tasks = [...initial]
  let statusBody: Record<string, unknown> | undefined
  let reorderBody: Record<string, unknown> | undefined

  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: MANAGER }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
  await page.route('**/tasks/stream*', (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' }),
  )

  // The cross-lane write: set a task's status to the lane it was dropped in. Mirror the DB trigger
  // (entering done stamps completed_at) so the refetched board matches what the API would return.
  await page.route('**/tasks/*/status', (route) => {
    statusBody = route.request().postDataJSON()
    const id = route.request().url().split('/tasks/')[1].split('/status')[0]
    const index = tasks.findIndex((t) => t.id === id)
    const status = (statusBody as { status: StubTask['status'] }).status
    if (index !== -1) {
      tasks[index] = {
        ...tasks[index],
        status,
        completedAt: status === 'done' ? STAMP : null,
      }
    }
    return route.fulfill({ json: wire(tasks[index]) })
  })

  // The within-lane write: rewrite the named location's positions to the sent order.
  await page.route('**/tasks/reorder', (route) => {
    reorderBody = route.request().postDataJSON()
    const orderedIds = (reorderBody as { orderedIds: string[] }).orderedIds
    orderedIds.forEach((id, position) => {
      const index = tasks.findIndex((t) => t.id === id)
      if (index !== -1) tasks[index] = { ...tasks[index], position }
    })
    return route.fulfill({ json: boardResponse(tasks) })
  })

  // The board read always peeks (#136), so the query string is part of the matched URL; the seen
  // report the screen sends on mount/unmount is acknowledged so it never leaves the stub world.
  await page.route('**/tasks?peek=1', (route) => route.fulfill({ json: boardResponse(tasks) }))
  await page.route('**/tasks/seen', (route) => route.fulfill({ json: { lastSeenAt: STAMP } }))

  return {
    statusBody: () => statusBody,
    reorderBody: () => reorderBody,
  }
}

// Drive a dnd-kit pointer drag from a card's grip onto a target, with the intermediate moves the
// PointerSensor needs: a first move past its 6px activation distance to start the drag, a move to the
// target, and a settling move so the collision registers before the drop.
async function dragGripOnto(page: Page, gripLabel: string, target: Locator) {
  const grip = page.getByRole('button', { name: gripLabel })
  const from = await grip.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('expected both the grip and the target to be laid out')

  const fromX = from.x + from.width / 2
  const fromY = from.y + from.height / 2
  const toX = to.x + to.width / 2
  const toY = to.y + to.height / 2

  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(fromX + 12, fromY + 12, { steps: 5 })
  await page.mouse.move(toX, toY, { steps: 12 })
  await page.mouse.move(toX, toY)
  await page.mouse.up()
}

test('dragging a card to another lane sets its status through the status endpoint', async ({
  page,
}) => {
  const board = await installBoard(page, [
    task({ id: TASK_A, title: 'Prep the grill', status: 'not_started', position: 0 }),
    // A card already in the target lane, so the drop lands on a real card in "In progress".
    task({ id: TASK_B, title: 'Wipe the counters', status: 'in_progress', position: 1 }),
  ])
  await page.goto('/tasks')

  // The board opens with each card in its status lane.
  await expect(
    page
      .getByRole('region', { name: 'Not started' })
      .getByRole('heading', { name: 'Prep the grill' }),
  ).toBeVisible()

  // Drag "Prep the grill" onto the In progress card — a cross-lane drop.
  await dragGripOnto(
    page,
    'Reorder Prep the grill',
    page.getByRole('heading', { name: 'Wipe the counters' }),
  )

  // The request the UI built is the dedicated status body, carrying only the target lane's status.
  await expect.poll(() => board.statusBody()).toBeTruthy()
  expect(board.statusBody()).toEqual({ status: 'in_progress' })

  // After the settle-refetch the moved card lives in the In progress lane, no longer in Not started.
  await expect(
    page
      .getByRole('region', { name: 'In progress' })
      .getByRole('heading', { name: 'Prep the grill' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Not started' })
      .getByRole('heading', { name: 'Prep the grill' }),
  ).toHaveCount(0)
})

test('dragging a card within a lane reorders it through the position endpoint', async ({
  page,
}) => {
  const board = await installBoard(page, [
    task({ id: TASK_A, title: 'First task', status: 'not_started', position: 0 }),
    task({ id: TASK_B, title: 'Second task', status: 'not_started', position: 1 }),
  ])
  await page.goto('/tasks')

  const notStarted = page.getByRole('region', { name: 'Not started' })
  // Opens in the shared manual order.
  await expect(notStarted.getByRole('heading', { level: 3 })).toHaveText([
    'First task',
    'Second task',
  ])

  // Drag the first card onto the second — a within-lane drop.
  await dragGripOnto(
    page,
    'Reorder First task',
    notStarted.getByRole('heading', { name: 'Second task' }),
  )

  // The request the UI built is the reorder body: the lane's ids in their new relative order.
  await expect.poll(() => board.reorderBody()).toBeTruthy()
  expect((board.reorderBody() as { orderedIds: string[] }).orderedIds).toEqual([TASK_B, TASK_A])

  // The optimistic patch shows the new order at once — no status change, both cards stay in the lane.
  await expect(notStarted.getByRole('heading', { level: 3 })).toHaveText([
    'Second task',
    'First task',
  ])
})
