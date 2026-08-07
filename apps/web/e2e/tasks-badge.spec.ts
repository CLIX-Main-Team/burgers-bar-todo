import { type Page, expect, test } from '@playwright/test'

// The Tasks-destination unseen-assignments badge (#136), exercised against the built bundle with
// the session and the board read stubbed at the network edge (the same approach as tasks.spec.ts).
// The counting boundaries are proven in the unseen unit suite and the marker semantics in the API
// suite; here we prove what a staff member observes: away from the board the destination carries
// the count of assignments newer than their last visit, on the board it never shows, and visiting
// the board reports the view (POST /tasks/seen) and clears the count in place.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'employee',
  locationId: LOCATION_A,
  status: 'active',
} as const

const STAMP = '2026-01-01T00:00:00.000Z'
// The viewer's last board visit, and one assignment either side of it: strictly-after is new,
// at-or-before is seen. The board response carries all three so the rendered count (2) proves the
// filter, not just presence.
const MARKER = '2026-01-10T00:00:00.000Z'
const BEFORE_MARKER = '2026-01-09T00:00:00.000Z'
const AFTER_MARKER = '2026-01-11T00:00:00.000Z'
const NOW = '2026-01-12T00:00:00.000Z'

function assignedTask(id: string, title: string, assignedAt: string) {
  return {
    id,
    locationId: LOCATION_A,
    title,
    description: null,
    status: 'not_started' as const,
    priority: 'normal' as const,
    dueDate: null,
    completedAt: null,
    position: 0,
    assignees: [{ id: EMPLOYEE.userId, displayName: 'Dana', assignedAt }],
    createdBy: { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', displayName: 'Maya Manager' },
    createdAt: STAMP,
    updatedAt: STAMP,
  }
}

// Two assignments newer than the marker, one older — the badge should read exactly 2.
function boardWithTwoUnseen() {
  return {
    tasks: [
      assignedTask('aaaaaaa1-0000-0000-0000-000000000001', 'Prep the grill', AFTER_MARKER),
      assignedTask('aaaaaaa2-0000-0000-0000-000000000002', 'Close the register', AFTER_MARKER),
      assignedTask('aaaaaaa3-0000-0000-0000-000000000003', 'Restock napkins', BEFORE_MARKER),
    ],
    lastSeenAt: MARKER,
  }
}

// Install the session, the peeking board read, the seen report, and the assistant surface the
// non-board screen needs. Returns a handle counting the seen reports the SPA sent.
async function stubShell(
  page: Page,
  board: ReturnType<typeof boardWithTwoUnseen>,
): Promise<{ seenReports: () => number }> {
  let seenReports = 0
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: EMPLOYEE }))
  await page.route('**/threads', (route) => route.fulfill({ json: { threads: [] } }))
  await page.route('**/tasks/stream*', (route) =>
    route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: '' }),
  )
  await page.route('**/tasks?peek=1', (route) => route.fulfill({ json: board }))
  await page.route('**/tasks/seen', (route) => {
    seenReports += 1
    return route.fulfill({ json: { lastSeenAt: NOW } })
  })
  return { seenReports: () => seenReports }
}

test('away from the board, the Tasks destination counts assignments newer than the last visit', async ({
  page,
}) => {
  await stubShell(page, boardWithTwoUnseen())
  await page.goto('/assistant')

  // The desktop side nav's Tasks row carries the pill: exactly the two strictly-newer assignments,
  // not the one at-or-before the marker. The accessible sentence rides along for assistive tech.
  const tasksRow = page.getByTestId('side-nav').getByRole('link', { name: /Tasks/ })
  await expect(tasksRow.getByText('2', { exact: true })).toBeVisible()
  await expect(tasksRow.getByText('2 new assignments')).toHaveCount(1)
})

test('visiting the board reports the view and clears the badge in place', async ({ page }) => {
  const handle = await stubShell(page, boardWithTwoUnseen())
  await page.goto('/assistant')

  const sideNav = page.getByTestId('side-nav')
  const tasksRow = sideNav.getByRole('link', { name: /Tasks/ })
  await expect(tasksRow.getByText('2', { exact: true })).toBeVisible()

  // Open the board: the destination is now active, so the pill leaves at once — on the board, the
  // visit itself is the acknowledgement — and the screen reports the view server-side.
  await tasksRow.click()
  await expect(page.getByRole('heading', { name: 'Prep the grill' })).toBeVisible()
  await expect(tasksRow.getByText('2', { exact: true })).toHaveCount(0)
  await expect.poll(handle.seenReports).toBeGreaterThan(0)

  // Leave for the Assistant again: the cached marker was patched from the seen response, so the
  // once-new assignments are now seen and no pill returns — without any fresh board read.
  await sideNav.getByRole('link', { name: /Assistant/ }).click()
  await expect(page.getByRole('textbox', { name: 'Your question' })).toBeVisible()
  await expect(tasksRow.getByText('2', { exact: true })).toHaveCount(0)
})

test.describe('phone shell', () => {
  test.use({ viewport: { width: 390, height: 720 } })

  test('the bottom tab bar carries the same count on the Tasks tab', async ({ page }) => {
    await stubShell(page, boardWithTwoUnseen())
    await page.goto('/assistant')

    // The mobile twin: the side nav is display:none below md (out of the accessibility tree), so
    // the one matching link is the bottom tab, whose icon corner floats the pill.
    const tasksTab = page.getByRole('link', { name: /Tasks/ })
    await expect(tasksTab.getByText('2', { exact: true })).toBeVisible()
  })
})
