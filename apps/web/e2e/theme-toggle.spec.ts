import { type Page, expect, test } from '@playwright/test'

// The light/dark theme toggle (issue #101, TC-DSW-05..09). Same harness as the other
// shell specs: the built bundle under preview, the session stubbed at the network edge by
// seeding a bearer and fulfilling /auth/me, so the toggle — which lives in the account
// menu behind the header avatar — is exercised without a live API. The behaviour under
// test is the ThemeProvider's contract: default light, class-based-explicit (no OS
// auto-detect), persisted across reload, with aria-pressed tracking the showing theme.

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
} as const

async function stubSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: EMPLOYEE }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
}

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click()
}

test('defaults to light on first load, with no dark class on the root (TC-DSW-05)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')

  // With no stored preference the app renders light: the root carries no dark class.
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
})

test('choosing Dark stamps the dark theme and the pressed state, with no navigation (TC-DSW-06, TC-DSW-08)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await openMenu(page)

  await page.getByRole('button', { name: 'Dark' }).click()

  // The whole app flips at once: the root gains the dark class and the URL is unchanged.
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page).toHaveURL(/\/tasks$/)
  // Exactly one option is pressed, matching the showing theme.
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
})

test('the dark choice persists across a reload, with no flash of light (TC-DSW-07)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await openMenu(page)
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.reload()

  // The pre-paint read applies the stored theme before first paint, so the root is dark
  // immediately on the reloaded document, read back from localStorage.
  await expect(page.locator('html')).toHaveClass(/dark/)
  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
})

test('each theme option leads with its glyph, its accessible name unchanged (Slice 3)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await openMenu(page)

  // Light draws one decorative sun and Dark one decorative moon (iconography.md, roles
  // theme-light / theme-dark). The glyphs are aria-hidden, so the buttons a screen-reader
  // announces stay 'Light' / 'Dark' — the exact names the aria-pressed specs above key off.
  await expect(page.getByRole('button', { name: 'Light' }).locator('svg')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Dark' }).locator('svg')).toHaveCount(1)
})

test('does not auto-detect a dark OS: with no stored choice the app opens light (TC-DSW-09)', async ({
  page,
}) => {
  await stubSession(page)
  // Emulate a dark operating system; the class-based-explicit decision (#68) means the app
  // still opens light because there is no stored preference and no prefers-color-scheme read.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/tasks')

  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
})
