import { type Page, expect, test } from '@playwright/test'

// These exercise the built bundle (playwright.config drives `vite build` + preview), with
// the session stubbed at the network edge rather than by signing in for real: a bearer is
// seeded into storage so the session provider runs its /auth/me read, and that read is
// fulfilled by route interception. This keeps the shell's navigation under test without a
// live API, exactly as the ticket calls for.
//
// The app has two shells that flip at `md` (768px): the phone shell (sticky header + bottom
// tab-bar) below `md`, and the desktop shell (persistent side nav + wide content) from `md`.
// The phone shell moved onto real sessions in shell.live.spec.ts (#197); the desktop shell —
// added later by #208/#209, which #197 predates — stays stubbed here, pinned to a desktop
// viewport so it renders instead of the bottom bar.

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

// Seed the bearer before any app script runs (so the provider sees a token and issues the
// me read) and fulfil the principal read plus the people list. The logout endpoints are
// stubbed to succeed so the wiring under test is the client's own return-to-login. The token
// value is irrelevant — the API is stubbed — it only has to be present.
async function stubSession(page: Page, principal: Principal) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
  await page.route('**/auth/logout', (route) => route.fulfill({ json: { ok: true } }))
  await page.route('**/auth/logout-all', (route) => route.fulfill({ json: { ok: true } }))
}

// ============================================================================
// Desktop shell (≥ md): the bottom tab-bar and mobile header give way to the
// persistent side nav. Pinned to a desktop viewport so it renders.
// ============================================================================
test.describe('desktop shell', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('at md the side nav replaces the bar, showing the brand and the two everyday destinations', async ({
    page,
  }) => {
    await stubSession(page, EMPLOYEE)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // The brand lockup is the side nav's own — the bottom bar never carried it. Since the
    // 2026-08-12 refresh it is the Wordmark device (role="img" named by the app name), so
    // there is no literal "Burgers Bar" text node to find.
    await expect(nav.getByRole('img', { name: 'Burgers Bar' })).toBeVisible()
    // An employee gets exactly the two role-invariant destinations, no admin rows.
    await expect(nav.getByRole('link')).toHaveCount(2)
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('a manager gets the provisioner nav rows — People and Knowledge — absent from the account foot menu', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Ticket B (#209): People is promoted to its own nav row for anyone who may provision;
    // ADR-0024 adds Knowledge on the same gate. A manager sees four rows — Tasks, Assistant,
    // People, Knowledge — but not Locations (admin-only).
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toHaveCount(0)

    // Now that People lives in the nav, the desktop foot menu drops it (no second door).
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })

  test('an admin gets five nav rows — Locations on top of the manager set — with none in the foot menu', async ({
    page,
  }) => {
    await stubSession(page, ADMIN)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // An admin adds the admin-only Locations row on top of the manager's four.
    await expect(nav.getByRole('link')).toHaveCount(5)
    await expect(nav.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toBeVisible()

    // The foot menu carries neither admin surface on desktop — the nav owns them both.
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })

  test('the People nav row navigates to /people and stamps aria-current', async ({ page }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('link', { name: 'People' }).click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(nav.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('the active row tracks the URL — aria-current stamped and the glyph filled', async ({
    page,
  }) => {
    await stubSession(page, EMPLOYEE)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    const tasksLink = nav.getByRole('link', { name: 'Tasks' })
    const assistantLink = nav.getByRole('link', { name: 'Assistant' })

    await expect(tasksLink).toHaveAttribute('aria-current', 'page')
    // The active glyph renders at `fill`; its path geometry differs from the inactive weight,
    // the second non-colour active signal (iconography.md).
    const tasksPath = tasksLink.locator('svg path').first()
    const filledWhenActive = await tasksPath.getAttribute('d')

    await assistantLink.click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(assistantLink).toHaveAttribute('aria-current', 'page')
    await expect(tasksLink).not.toHaveAttribute('aria-current', 'page')
    expect(await tasksPath.getAttribute('d')).not.toBe(filledWhenActive)
  })

  test('the account foot opens the settings menu — theme, language, log out — but no admin entries; logout returns to login', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    // Closed: nothing from the menu is on the page yet.
    await expect(page.getByRole('button', { name: 'Light' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dark' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
    // On desktop the foot menu is settings-only: People and Locations live in the nav (#209),
    // so the foot drops the Manage entries even for a manager who can reach People.
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Log out', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('Hebrew mirrors the side nav to the inline-start (the right edge)', async ({ page }) => {
    await stubSession(page, EMPLOYEE)
    await page.goto('/tasks')

    // Located by test id, not accessible name: the nav's aria-label is itself translated
    // ("Primary" → "ראשי"), so a name-based locator would stop matching after the flip.
    const nav = page.getByTestId('side-nav')
    const html = page.locator('html')

    const viewportWidth = page.viewportSize()?.width ?? 0

    // LTR: the inline-start nav hugs the left edge.
    await expect(html).toHaveAttribute('dir', 'ltr')
    const ltrBox = await nav.boundingBox()
    expect(ltrBox?.x ?? 999).toBeLessThan(4)

    // Flip to Hebrew from the account foot; logical properties mirror the nav to the right
    // with no direction-specific CSS.
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(html).toHaveAttribute('dir', 'rtl')

    const rtlBox = await nav.boundingBox()
    expect(rtlBox ? rtlBox.x + rtlBox.width : 0).toBeGreaterThan(viewportWidth - 4)
    expect(rtlBox?.x ?? 0).toBeGreaterThan(viewportWidth / 2)
  })
})
