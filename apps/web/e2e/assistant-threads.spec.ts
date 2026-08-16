import { type Page, expect, test } from '@playwright/test'

// Assistant thread management (#94), exercised against the built bundle with the session and the
// assistant reads stubbed at the network edge (the same approach as assistant.spec.ts). The thread
// list and read endpoints are proven in the API integration suite; here we prove the UI a staff
// member observes: the drawer lists their conversations, switching loads a thread's history, a new
// -thread action starts fresh, example chips populate the composer, and the drawer is direction-aware.
// Every assertion is on what the user sees, never on component state.

// A phone-sized viewport: this surface is mobile-first and one-handed.
test.use({ viewport: { width: 390, height: 720 } })

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
} as const

const STAMP = '2026-01-01T00:00:00.000Z'

const THREAD_A = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'Opening routine',
  createdAt: STAMP,
  updatedAt: STAMP,
}
const THREAD_B = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'Refund policy',
  createdAt: STAMP,
  updatedAt: STAMP,
}

// One thread's full history, keyed by id, as GET /threads/:id returns it. Each carries a distinctive
// answer so a switch is provable by the reply that appears.
const DETAILS: Record<string, unknown> = {
  [THREAD_A.id]: {
    ...THREAD_A,
    messages: [
      { id: 'a-u', role: 'user', content: 'How do I open the store?', createdAt: STAMP },
      { id: 'a-a', role: 'agent', content: 'Unlock, then count the float.', createdAt: STAMP },
    ],
  },
  // Thread B carries the create-then-answer doubling ADR-0003 persists on a first thread: the opening
  // question is stored as two identical user turns before the reply. Reopening it must show that
  // question once — the collapse is unit-proven in thread-history.test.ts and end-to-end here.
  [THREAD_B.id]: {
    ...THREAD_B,
    messages: [
      { id: 'b-create', role: 'user', content: 'What is the refund policy?', createdAt: STAMP },
      { id: 'b-user', role: 'user', content: 'What is the refund policy?', createdAt: STAMP },
      { id: 'b-agent', role: 'agent', content: 'Refunds within 14 days.', createdAt: STAMP },
    ],
  },
}

// Seed the bearer so the session provider issues its /auth/me read, fulfil that with the employee
// principal, and wire the two assistant reads: the thread list and one thread's history. No write
// route is stubbed — these cases never send a question.
async function stubThreads(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: EMPLOYEE }))
  // GET /threads lists the caller's conversations, most-recently-active first.
  await page.route('**/threads', (route) =>
    route.fulfill({ status: 200, json: { threads: [THREAD_B, THREAD_A] } }),
  )
  // GET /threads/:id opens one with its history; the id is the last path segment.
  await page.route('**/threads/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const detail = DETAILS[id]
    return detail
      ? route.fulfill({ status: 200, json: detail })
      : route.fulfill({ status: 404, json: { error: 'not_found' } })
  })
}

function openDrawer(page: Page, name: string) {
  return page.getByRole('button', { name }).click()
}

test('the drawer lists the user’s conversations and switching loads a thread’s history', async ({
  page,
}) => {
  await stubThreads(page)
  await page.goto('/assistant')

  await openDrawer(page, 'Your conversations')

  // The drawer opens and lists both conversations by their server-derived titles.
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: /^Opening routine/ })).toBeVisible()
  await expect(drawer.getByRole('button', { name: /^Refund policy/ })).toBeVisible()

  // Selecting a thread switches the conversation to that thread's history and closes the drawer.
  await drawer.getByRole('button', { name: /^Refund policy/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(
    'Refunds within 14 days.',
  )
  // The opening question shows exactly once — the persisted create-then-answer doubling is collapsed.
  await expect(page.getByText('What is the refund policy?', { exact: true })).toHaveCount(1)

  // Reopening the drawer marks the conversation the reader is now in.
  await openDrawer(page, 'Your conversations')
  await expect(page.getByRole('button', { name: /^Refund policy/ })).toHaveAttribute(
    'aria-current',
    'true',
  )
})

test('a new-thread action starts a fresh conversation', async ({ page }) => {
  await stubThreads(page)
  await page.goto('/assistant')

  // Open a thread first, so there is a history to leave behind.
  await openDrawer(page, 'Your conversations')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Opening routine/ })
    .click()
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(
    'Unlock, then count the float.',
  )

  // Start fresh: the history clears, the drawer closes, and the empty-thread invitation and its
  // example chips return. Scoped to the drawer — the screen's header now carries its own
  // New conversation icon button (The Counter, round 8).
  await openDrawer(page, 'Your conversations')
  await page.getByRole('dialog').getByRole('button', { name: 'New conversation' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[aria-label="Assistant answer"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'What is the opening routine?' })).toBeVisible()
})

test('a return visit reopens the conversation that was open last', async ({ page }) => {
  await stubThreads(page)
  await page.goto('/assistant')

  // Open a conversation, leaving it as the remembered one.
  await openDrawer(page, 'Your conversations')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Opening routine/ })
    .click()
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(
    'Unlock, then count the float.',
  )

  // Come back to the tab afresh: the same history is already open — no drawer, no clean
  // new chat (the pile-of-duplicate-threads complaint, owner ask 2026-08-16).
  await page.goto('/assistant')
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(
    'Unlock, then count the float.',
  )
  await expect(page.getByRole('button', { name: 'What is the opening routine?' })).toHaveCount(0)
})

test('a stale remembered conversation falls back to the clean first-run state', async ({
  page,
}) => {
  await stubThreads(page)
  // A remembered id whose thread no longer exists (deleted, or another account's): the
  // restore must fail silently into the empty state, never surface the load-failed alert.
  await page.addInitScript(() => {
    localStorage.setItem('burgers.assistant.lastThread', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
  })
  await page.goto('/assistant')

  await expect(page.getByRole('button', { name: 'What is the opening routine?' })).toBeVisible()
  await expect(page.getByText('Your conversations could not be loaded. Try again.')).toHaveCount(0)
})

test('example-question chips populate the composer when tapped', async ({ page }) => {
  await stubThreads(page)
  await page.goto('/assistant')

  // On the empty thread the chips are offered; tapping one fills the composer without sending it.
  const chip = page.getByRole('button', { name: 'Which tasks are open right now?' })
  await expect(chip).toBeVisible()
  await chip.click()

  await expect(page.getByRole('textbox', { name: 'Your question' })).toHaveValue(
    'Which tasks are open right now?',
  )
  // The answer path was never called — the chip populates, it does not ask.
  await expect(page.locator('[aria-label="Assistant answer"]')).toHaveCount(0)
})

test('deleting the open conversation removes it from the list and resets the view', async ({
  page,
}) => {
  await stubThreads(page)
  // The delete write (#257), stubbed mutably like the board's delete spec: the POST marks the
  // thread gone, and the list re-read that follows returns the survivors — so the assertion drives
  // the same invalidate-and-refetch loop the real backend serves.
  let deletedId: string | null = null
  await page.route('**/threads', (route) =>
    route.fulfill({
      status: 200,
      json: { threads: [THREAD_B, THREAD_A].filter((thread) => thread.id !== deletedId) },
    }),
  )
  await page.route('**/threads/*/delete', (route) => {
    deletedId = new URL(route.request().url()).pathname.split('/').at(-2) ?? null
    return route.fulfill({ status: 200, json: { status: 'ok' } })
  })
  await page.goto('/assistant')

  // Open a conversation so the delete hits the active one.
  await openDrawer(page, 'Your conversations')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Opening routine/ })
    .click()
  await expect(page.locator('[aria-label="Assistant answer"]')).toContainText(
    'Unlock, then count the float.',
  )

  // The row's overflow menu offers Delete; the AlertDialog confirms before anything is destroyed.
  await openDrawer(page, 'Your conversations')
  await page.getByRole('button', { name: 'Actions for Opening routine' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(page.getByText('Delete this conversation?')).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()

  // The hard delete landed, the row is gone from the refetched list, and — because it was the open
  // conversation — the view resets to the empty first-run state with the drawer closed.
  await expect.poll(() => deletedId).toBe(THREAD_A.id)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[aria-label="Assistant answer"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'What is the opening routine?' })).toBeVisible()

  // The survivor is still listed; the deleted conversation is not.
  await openDrawer(page, 'Your conversations')
  await expect(page.getByRole('button', { name: /^Refund policy/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Opening routine/ })).toHaveCount(0)
})

test('the drawer and thread list are direction-aware in Hebrew RTL', async ({ page }) => {
  await stubThreads(page)
  await page.goto('/assistant')

  // Flip to Hebrew from the account menu; the whole document flips to RTL.
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  // Dismiss the account menu so it cannot overlap the drawer toggle in the header.
  await page.keyboard.press('Escape')

  // The drawer chrome resolves from the Hebrew `assistant` namespace, and the titles still list.
  await openDrawer(page, 'השיחות שלכם')
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'שיחות' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'שיחה חדשה' })).toBeVisible()
  await expect(drawer.getByRole('button', { name: /^Opening routine/ })).toBeVisible()
})
