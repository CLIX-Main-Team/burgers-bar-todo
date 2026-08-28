import { capabilitiesFor } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The Light/Dark theme toggle (issue #101, TC-DSW-05..09; labels were Day/Night from The
// Counter round 8 until 2026-08-27). Same harness as the other shell specs: the built bundle under
// preview, the session stubbed at the network edge by seeding a bearer and fulfilling
// /auth/me, so the toggle — which lives in the account menu behind the header avatar — is
// exercised without a live API. The behaviour under test is the ThemeProvider's contract:
// default DARK (flipped 2026-08-27), class-based-explicit (no OS auto-detect), persisted
// aria-pressed tracking the showing theme.

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('employee'),
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

// The browser/OS chrome tint follows the theme again as of round 14 (2026-08-27), which ended
// The Counter's one-black-chrome-for-both rule: each theme names the surface actually under
// the bar — the day rail's white, the night canvas's charcoal.
// Same literals as theme.tsx's THEME_COLOR_* and the index.html meta.
const CHROME_LIGHT = '#FFFFFF'
const CHROME_DARK = '#0C0E11'

function themeColor(page: Page) {
  return page.locator('meta[name="theme-color"]')
}

// The toggle lives behind the mobile shell's header avatar; pin a phone viewport so these
// exercise that menu (the desktop shell carries the same toggle in its account foot).
test.use({ viewport: { width: 390, height: 720 } })

test('defaults to dark on first load, stamping the dark class on the root (TC-DSW-05)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')

  // With no stored preference the app renders dark (2026-08-27): the root carries the class.
  await expect(page.locator('html')).toHaveClass(/dark/)

  await expect(themeColor(page)).toHaveAttribute('content', CHROME_DARK)

  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false')
})

test('choosing Light drops the dark theme and moves the pressed state, with no navigation (TC-DSW-06, TC-DSW-08)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await openMenu(page)

  await page.getByRole('button', { name: 'Light' }).click()

  // The whole app flips at once: the root loses the dark class, the chrome tint follows it to
  // the day rail, and the URL is unchanged.
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(themeColor(page)).toHaveAttribute('content', CHROME_LIGHT)
  await expect(page).toHaveURL(/\/tasks$/)
  // Exactly one option is pressed, matching the showing theme.
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false')
})

test('the light choice persists across a reload, with no flash of dark (TC-DSW-07)', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await openMenu(page)
  await page.getByRole('button', { name: 'Light' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.reload()

  // The stored choice is the interesting direction now that dark is the default: the pre-paint
  // read has to WITHHOLD the class it would otherwise add, so a light user never flashes dark.
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true')
})

test('does not auto-detect a light OS: with no stored choice the app opens dark (TC-DSW-09)', async ({
  page,
}) => {
  await stubSession(page)
  // Emulate a light operating system; the class-based-explicit decision (#68) means the app
  // still opens dark because there is no stored preference and no prefers-color-scheme read.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/tasks')

  await expect(page.locator('html')).toHaveClass(/dark/)
  await openMenu(page)
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
})
