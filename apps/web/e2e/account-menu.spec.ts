import { type Page, expect, test } from '@playwright/test'

// The header avatar account menu (Ticket 2). Same harness as shell.spec: the built
// bundle under preview, the session stubbed at the network edge by seeding a bearer and
// fulfilling /auth/me by role, so the menu's role-dependent contents and the logout wiring
// are exercised without a live API.

const ADMIN = {
  userId: '44444444-4444-4444-4444-444444444444',
  role: 'admin',
  locationId: null,
  status: 'active',
} as const

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

type Principal = typeof ADMIN | typeof MANAGER | typeof EMPLOYEE

// Seed the bearer before any app script runs and fulfil the principal read plus the
// people list. The logout endpoints are stubbed to succeed so the wiring under test is
// the client's own return-to-login, not the API's.
async function stubSession(page: Page, principal: Principal) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
  await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/auth/logout-all', (route) => route.fulfill({ json: { ok: true } }))
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click()
}

// This is the mobile shell's header menu. Pin a phone viewport so it renders the header
// avatar and its full menu — the desktop shell (≥ md) promotes People/Locations to side-nav
// rows and drops them from the account foot, which is covered in shell.spec's desktop block.
test.use({ viewport: { width: 390, height: 720 } })

test('the menu shows identity, language, and both logout actions for an employee', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')
  await openMenu(page)

  // Read-only identity: the role we have from /auth/me, so the account is confirmable.
  await expect(page.getByText('Signed in as Employee')).toBeVisible()
  // The language toggle relocated here, unchanged.
  await expect(page.getByRole('button', { name: 'עברית' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
  // Both logout actions, for every role.
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log out of all devices' })).toBeVisible()
  // No Manage users entry for an employee.
  await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
})

test('the avatar trigger draws its glyph through the registry without losing its name', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')

  // The hand-rolled inline svg is gone: the trigger now draws exactly one decorative
  // <Icon> svg (account-avatar / user-circle), while its accessible name — the thing a
  // screen-reader announces — stays 'Account' (Slice 2, iconography.md).
  const trigger = page.getByRole('button', { name: 'Account' })
  await expect(trigger.locator('svg')).toHaveCount(1)
})

test('the menu items carry their leading glyphs', async ({ page }) => {
  await stubSession(page, MANAGER)
  await page.goto('/tasks')
  await openMenu(page)

  // Each actioned item leads with one decorative glyph — Manage users (users), and both
  // logout actions (sign-out) — named by the item's own text, not the icon.
  await expect(page.getByRole('link', { name: 'Manage users' }).locator('svg')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Log out', exact: true }).locator('svg'),
  ).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Log out of all devices' }).locator('svg'),
  ).toHaveCount(1)
})

test('the language toggle carries one leading translate glyph on its control', async ({ page }) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')
  await openMenu(page)

  // Unlike the theme toggle there is no per-option glyph, so the control leads with a single
  // decorative translate mark (iconography.md, role language). The fieldset is a labelled
  // group; its one svg is that glyph — the English / Hebrew buttons stay text-only, their
  // accessible names untouched (Slice 3).
  await expect(page.getByRole('group', { name: 'Language' }).locator('svg')).toHaveCount(1)
})

test('a manager sees a Manage users entry in the menu', async ({ page }) => {
  await stubSession(page, MANAGER)
  await page.goto('/tasks')
  await openMenu(page)

  await expect(page.getByText('Signed in as Manager')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
})

test('an admin sees a Manage users entry in the menu', async ({ page }) => {
  await stubSession(page, ADMIN)
  await page.goto('/tasks')
  await openMenu(page)

  await expect(page.getByText('Signed in as Admin')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
})

test('the language choice made in the menu persists when the menu is reopened', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')
  const html = page.locator('html')

  await openMenu(page)
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(html).toHaveAttribute('dir', 'rtl')

  // Close the menu (Escape), then reopen it — the trigger's label is now Hebrew — and the
  // Hebrew choice is still the selected one, not reset to the default.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'עברית' })).toHaveCount(0)
  await page.getByRole('button', { name: 'חשבון' }).click()
  await expect(page.getByRole('button', { name: 'עברית' })).toHaveAttribute('aria-pressed', 'true')
  await expect(html).toHaveAttribute('dir', 'rtl')
})

test('log out returns the app to login', async ({ page }) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/tasks')
  await openMenu(page)

  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('log out of all devices returns the app to login', async ({ page }) => {
  await stubSession(page, MANAGER)
  await page.goto('/tasks')
  await openMenu(page)

  await page.getByRole('button', { name: 'Log out of all devices' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('an employee navigating directly to /people is redirected to the task board', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE)
  await page.goto('/people')

  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
})

test('a manager reaching /people directly sees the people screen', async ({ page }) => {
  await stubSession(page, MANAGER)
  await page.goto('/people')

  await expect(page).toHaveURL(/\/people$/)
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
})
