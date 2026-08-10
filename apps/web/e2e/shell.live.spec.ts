import { expect, test } from '@playwright/test'
import { STORAGE_STATE } from './env.js'

// The phone shell (bottom bar + header account menu, below `md`) on the live backbone (#151,
// converting #197). Where the stubbed shell.spec.ts seeded a bearer and fulfilled /auth/me at
// the network edge, these open with a *real* persona session — the bearer the setup minted,
// attached per role at the describe level (`test.use`, the people.live pattern) — so the shell's
// navigation runs behind the real API's own /auth/me read.
//
// The whole file pins a phone viewport: the app flips to a desktop side-nav shell at `md`
// (#208/#209), which #197 predates. That desktop shell stays covered, stubbed, in shell.spec's
// desktop block — this live conversion is the phone shell only.
//
// Nothing here mutates the session, so the shared persona sessions are safe to reuse: Eli
// (employee, two-tab bar), Mia (manager, a third People tab), and Ada (admin, People and
// Locations tabs) — the bar draws the same role-gated destinations list as the desktop side
// nav (owner call 2026-08), and the account menu carries no nav rows on either shell.
test.use({ viewport: { width: 390, height: 720 } })

test.describe('the phone shell for an employee session', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('visiting / redirects to /tasks and shows the Tasks tab active', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('the bottom bar shows exactly two tabs for an employee', async ({ page }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link')).toHaveCount(2)
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
  })

  test('each bottom-bar destination shows its icon, and the active one renders filled', async ({
    page,
  }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    const tasksLink = nav.getByRole('link', { name: 'Tasks' })
    const assistantLink = nav.getByRole('link', { name: 'Assistant' })

    // Each destination draws exactly one glyph — the decorative <Icon> svg. The blue primary
    // dot is a <span>, so a single svg per link confirms the icon rendered (iconography.md).
    await expect(tasksLink.locator('svg')).toHaveCount(1)
    await expect(assistantLink.locator('svg')).toHaveCount(1)

    // The active destination renders at the reserved `fill` weight, inactive at `regular` —
    // Phosphor draws a different path geometry per weight, so the Tasks glyph's path differs
    // between active (on /tasks) and inactive (on /assistant). That difference is the second,
    // non-colour active signal the weight axis was chosen for.
    const tasksPath = tasksLink.locator('svg path').first()
    const filledWhenActive = await tasksPath.getAttribute('d')
    expect(filledWhenActive).toBeTruthy()

    await assistantLink.click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(tasksLink).not.toHaveAttribute('aria-current', 'page')
    const regularWhenInactive = await tasksPath.getAttribute('d')

    expect(filledWhenActive).not.toBe(regularWhenInactive)
  })

  test('tapping Assistant then Tasks moves between the two and tracks the active tab', async ({
    page,
  }) => {
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
    await page.goto('/tasks')

    const html = page.locator('html')
    await expect(html).toHaveAttribute('dir', 'ltr')
    await expect(html).toHaveAttribute('lang', 'en')

    // The language toggle now lives inside the account menu; open it first.
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(html).toHaveAttribute('dir', 'rtl')
    await expect(html).toHaveAttribute('lang', 'he')

    await page.getByRole('button', { name: 'English' }).click()
    await expect(html).toHaveAttribute('dir', 'ltr')
    await expect(html).toHaveAttribute('lang', 'en')
  })
})

test.describe('the phone shell for a manager session', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('a manager gets a third People tab in the bar, and no nav rows in the account menu', async ({
    page,
  }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // The bar draws the shared role-gated destinations (owner call 2026-08): a manager sees
    // Tasks, Assistant, and People — Locations stays admin-only — and the account menu no
    // longer offers a second door to the same place.
    await expect(nav.getByRole('link')).toHaveCount(3)
    await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
  })

  test('a manager can reach the people surface at /people from the bar', async ({ page }) => {
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('link', { name: 'People' }).click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('the phone shell for an admin session', () => {
  test.use({ storageState: STORAGE_STATE.admin })

  test('an admin gets People and Locations tabs in the bar, and none in the account menu', async ({
    page,
  }) => {
    await page.goto('/tasks')

    // The bar carries all four destinations for an admin (owner call 2026-08) — the same
    // role-gated list the desktop side nav draws — and the account menu drops its nav rows,
    // on mobile as on desktop, rather than offer a second door.
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toBeVisible()
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })
})
