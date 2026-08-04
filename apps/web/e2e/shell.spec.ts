import { type Page, expect, test } from '@playwright/test'

// These exercise the built bundle (playwright.config drives `vite build` + preview), with
// the session stubbed at the network edge rather than by signing in for real: a bearer is
// seeded into storage so the session provider runs its /auth/me read, and that read is
// fulfilled by route interception. This keeps the shell's navigation under test without a
// live API, exactly as the ticket calls for.
//
// The app has two shells that flip at `md` (768px): the phone shell (sticky header + bottom
// tab-bar) below `md`, and the desktop shell (persistent side nav + wide content) from `md`.
// The two blocks below pin the matching viewport so each renders the shell it tests.

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
// Phone shell (< md): sticky header + bottom tab-bar. Unchanged by the desktop
// shell; pinned to a phone viewport so it renders instead of the side nav.
// ============================================================================
test.describe('phone shell', () => {
  test.use({ viewport: { width: 390, height: 720 } })

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

  test('each bottom-bar destination shows its icon, and the active one renders filled', async ({
    page,
  }) => {
    await stubSession(page, EMPLOYEE)
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    const tasksLink = nav.getByRole('link', { name: 'Tasks' })
    const assistantLink = nav.getByRole('link', { name: 'Assistant' })

    // Each destination draws exactly one glyph — the decorative <Icon> svg. The gold primary
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

  test('a manager sees the same two tabs, with Manage users in the account menu not the bar', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Role-invariant bar: a manager gets exactly Tasks and Assistant, no third tab, and
    // Manage users lives behind the header avatar rather than the bar or inline.
    await expect(nav.getByRole('link')).toHaveCount(2)
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Account' }).click()
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

    // The language toggle now lives inside the account menu; open it first.
    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(html).toHaveAttribute('dir', 'rtl')
    await expect(html).toHaveAttribute('lang', 'he')

    await page.getByRole('button', { name: 'English' }).click()
    await expect(html).toHaveAttribute('dir', 'ltr')
    await expect(html).toHaveAttribute('lang', 'en')
  })

  test('a manager can reach the people surface at /people from the account menu', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('link', { name: 'Manage users' }).click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  })
})

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
    // The brand lockup is the side nav's own — the bottom bar never carried it.
    await expect(nav.getByText('Burgers Bar')).toBeVisible()
    // An employee gets exactly the two role-invariant destinations, no admin rows.
    await expect(nav.getByRole('link')).toHaveCount(2)
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('a manager keeps the two role-invariant rows; People stays in the account foot menu', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // The nav is role-invariant in this ticket — exactly Tasks and Assistant, no admin rows
    // (promoting them is Ticket B). A manager reaches People through the account foot menu.
    await expect(nav.getByRole('link')).toHaveCount(2)
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
    // Locations stays admin-only — absent for a manager even in the menu.
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })

  test('an admin reaches both People and Locations from the account foot menu', async ({
    page,
  }) => {
    await stubSession(page, ADMIN)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Still role-invariant chrome — two rows; the admin surfaces live in the foot menu.
    await expect(nav.getByRole('link')).toHaveCount(2)
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage locations' })).toBeVisible()
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

  test('the account foot opens the full menu with theme, language, People, and log out; logout returns to login', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    // Closed: nothing from the menu is on the page yet.
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dark' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
    // The desktop foot carries the full account menu, same content as mobile — People is
    // reachable here until a later ticket promotes it to a nav row.
    await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible()
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
