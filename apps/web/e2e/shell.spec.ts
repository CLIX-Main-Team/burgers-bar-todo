import { capabilitiesFor } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// These exercise the built bundle (playwright.config drives `vite build` + preview), with
// the session stubbed at the network edge rather than by signing in for real: a bearer is
// seeded into storage so the session provider runs its /auth/me read, and that read is
// fulfilled by route interception. This keeps the shell's navigation under test without a
// live API, exactly as the ticket calls for.
//
// The app has one shell at every width since the v2 handoff (§7): a navigation rail at the
// inline-start that changes measure at `md` (768px) — 74px of icons over labels below it,
// 240px of icon-and-label rows above. The phone header and bottom tab bar are gone.
// The phone shell moved onto real sessions in shell.live.spec.ts (#197); the desktop shell —
// added later by #208/#209, which #197 predates — stays stubbed here, pinned to a desktop
// viewport so it renders instead of the bottom bar.

const OWNER = {
  userId: '44444444-4444-4444-4444-444444444444',
  displayName: 'Shahar Adler',
  role: 'super_admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('admin'),
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  displayName: 'Yael Bar',
  role: 'manager',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('manager'),
} as const

const EMPLOYEE = {
  userId: '33333333-3333-3333-3333-333333333333',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('employee'),
} as const

type Principal = typeof OWNER | typeof MANAGER | typeof EMPLOYEE

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
// The rail at its desktop measure (≥ md): labelled rows, the wordmark, the account foot.
// Pinned to a desktop viewport.
// ============================================================================
test.describe('desktop shell', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('at md the side nav replaces the bar, showing the brand and the three everyday destinations', async ({
    page,
  }) => {
    await stubSession(page, EMPLOYEE)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // The brand lockup is the side nav's own — the bottom bar never carried it. Since the
    // 2026-08-12 refresh it is the Wordmark device (role="img" named by the app name), so
    // there is no literal "Burgers Bar" text node to find.
    await expect(nav.getByRole('img', { name: 'Burgers Bar' })).toBeVisible()
    // An employee gets the four role-invariant destinations, no admin rows. Dashboard joined
    // them in round 10 (2026-08-21) as the app's landing screen, and Projects on 2026-08-23,
    // when a project gained its own roles field and an employee got a projects view of their own.
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('a manager gets the provisioner Knowledge row; Users lives in the account foot menu', async ({
    page,
  }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Users left the everyday chrome (owner call 2026-08-13, during client testing): a
    // manager sees five rows — Dashboard, Tasks, Projects (v2), Assistant, Knowledge
    // (ADR-0024) — but not Locations (admin-only) and not Users, which the account menu
    // carries instead.
    await expect(nav.getByRole('link')).toHaveCount(5)
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Locations' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible()

    // The foot menu is the one door to Users now.
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })

  test('an admin gets six nav rows — Locations on top of the manager set — Users only in the foot menu', async ({
    page,
  }) => {
    await stubSession(page, OWNER)
    await page.goto('/tasks')

    const nav = page.getByRole('navigation', { name: 'Primary' })
    // An admin adds the admin-only Locations row on top of the manager's five.
    await expect(nav.getByRole('link')).toHaveCount(6)
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Locations' })).toBeVisible()

    // The foot menu carries Users (owner call 2026-08-13); Locations stays a nav row only.
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })

  test('the account menu Users row navigates to /people', async ({ page }) => {
    await stubSession(page, MANAGER)
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'Account' }).click()
    await page.getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL(/\/people$/)
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
    await expect(page.getByRole('button', { name: 'Day' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.getByRole('button', { name: 'Day' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Night' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
    // On desktop the foot menu is settings-only: Users and Locations live in the nav (#209),
    // so the foot drops the Manage entries even for a manager who can reach Users.
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
