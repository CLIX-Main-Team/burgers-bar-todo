import { type Page, expect, test } from '@playwright/test'

// These exercise the built bundle (playwright.config drives `vite build` + preview), with
// the session stubbed at the network edge rather than by signing in for real: a bearer is
// seeded into storage so the session provider runs its /auth/me read, and that read is
// fulfilled by route interception. This keeps the shell's navigation under test without a
// live API, exactly as the ticket calls for.

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'manager',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
} as const

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
} as const

// Seed the bearer before any app script runs (so the provider sees a token and issues the
// me read) and fulfil the principal read plus the people list. The token value is
// irrelevant — the API is stubbed — it only has to be present.
async function stubSession(page: Page, principal: typeof MANAGER | typeof EMPLOYEE) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
}

test('visiting / redirects to /tasks and shows the Tasks tab active', async ({ page }) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
})

test('the bottom bar shows exactly two tabs for an employee', async ({ page }) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav.getByRole('link')).toHaveCount(2)
  await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
})

test('a manager sees the same two tabs, with Manage users in the header not the bar', async ({
  page,
}) => {
  await stubSession(page, MANAGER)
  await page.goto('/tasks')
  const nav = page.getByRole('navigation', { name: 'Primary' })
  // Role-invariant bar: a manager gets exactly Tasks and Assistant, no third tab, and
  // Manage users lives in the header rather than the bar.
  await expect(nav.getByRole('link')).toHaveCount(2)
  await expect(nav.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
})

test('tapping Assistant then Tasks moves between the two and tracks the active tab', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')

  await page.getByRole('link', { name: 'Assistant' }).click()
  await expect(page).toHaveURL(/\/assistant$/)
  await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.getByRole('link', { name: 'Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
})

test('the active tab tracks the URL on a deep link and on browser back', async ({ page }) => {
  await stubSession(page, EMPLOYEE)

  // Deep link straight to Assistant: the bar reflects the URL, not any tap history.
  await page.goto('/assistant')
  await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Navigate to Tasks, then browser-back should return to Assistant with its tab active.
  await page.getByRole('link', { name: 'Tasks' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/assistant$/)
  await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

test('toggling Hebrew flips the document direction and language, and English flips back', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')

  const html = page.locator('html')
  await expect(html).toHaveAttribute('dir', 'ltr')
  await expect(html).toHaveAttribute('lang', 'en')

  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(html).toHaveAttribute('dir', 'rtl')
  await expect(html).toHaveAttribute('lang', 'he')

  await page.getByRole('button', { name: 'English' }).click()
  await expect(html).toHaveAttribute('dir', 'ltr')
  await expect(html).toHaveAttribute('lang', 'en')
})

test('a manager can reach the people surface at /people from the header link', async ({ page }) => {
  await stubSession(page, MANAGER)
  await page.goto('/tasks')

  await page.getByRole('link', { name: 'Manage users' }).click()
  await expect(page).toHaveURL(/\/people$/)
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
})
