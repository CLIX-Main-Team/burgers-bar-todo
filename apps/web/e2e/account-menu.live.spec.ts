import { type APIRequestContext, type Page, expect, test } from '@playwright/test'
import { FIXTURE_PERSONA_PASSWORDS, FIXTURE_USERS } from '../../api/test/helpers/fixture-cast.js'
import { API_BASE_URL, SESSION_TOKEN_KEY, STORAGE_STATE } from './env.js'

// The header avatar account menu on the live backbone (#151, converting #197). Where the
// stubbed account-menu.spec.ts seeded a bearer and fulfilled /auth/me by role at the network
// edge, these open with a *real* persona session — the bearer the setup minted, attached per
// role at the describe level (`test.use`, the people.live pattern) — so the menu's role-
// dependent contents and its gating are exercised against the real API's own /auth/me.
//
// The three personas map onto the three roles the menu branches on: Ada (admin), Mia
// (manager), Eli (employee). Identity ("Signed in as <Role>") reads the principal's role, so
// each describe's persona is exactly the role its assertions expect.
//
// The one action a shared backbone cannot host is `log out of all devices`: it revokes *every*
// session the user holds, which would kill the persona's saved storageState bearer the other
// live projects (session.live, shell.live, people.live) run against in parallel. That test
// stays stubbed in account-menu.spec.ts. `log out` (single device) *is* live here, on a
// throwaway session signed in fresh so revoking it leaves the shared persona session intact.
//
// This is the mobile shell's header menu, so the whole file pins a phone viewport. The menu is
// settings-and-logout only on every shell now: People/Locations are side-nav rows on desktop
// (#209) and tab-bar destinations on mobile (owner call 2026-08), so no role gets nav rows
// here — asserted per role below.
test.use({ viewport: { width: 390, height: 720 } })

async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click()
}

test.describe('the menu for an employee session', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('shows identity, language, and both logout actions', async ({ page }) => {
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
    await page.goto('/tasks')

    // The hand-rolled inline svg is gone: the trigger now draws exactly one decorative
    // <Icon> svg (account-avatar / user-circle), while its accessible name — the thing a
    // screen-reader announces — stays 'Account' (Slice 2, iconography.md).
    const trigger = page.getByRole('button', { name: 'Account' })
    await expect(trigger.locator('svg')).toHaveCount(1)
  })

  test('the language toggle carries one leading translate glyph on its control', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    // Unlike the theme toggle there is no per-option glyph, so the control leads with a single
    // decorative translate mark (iconography.md, role language). The fieldset is a labelled
    // group; its one svg is that glyph — the English / Hebrew buttons stay text-only, their
    // accessible names untouched (Slice 3).
    await expect(page.getByRole('group', { name: 'Language' }).locator('svg')).toHaveCount(1)
  })

  test('the language choice made in the menu persists when the menu is reopened', async ({
    page,
  }) => {
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
    await expect(page.getByRole('button', { name: 'עברית' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(html).toHaveAttribute('dir', 'rtl')
  })

  test('navigating directly to /people is redirected to the task board', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  })
})

test.describe('the menu for a manager session', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('the menu items carry their leading glyphs', async ({ page }) => {
    await page.goto('/tasks')
    await openMenu(page)

    // Each actioned item leads with one decorative glyph — both logout actions (sign-out) —
    // named by the item's own text, not the icon.
    await expect(
      page.getByRole('button', { name: 'Log out', exact: true }).locator('svg'),
    ).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Log out of all devices' }).locator('svg'),
    ).toHaveCount(1)
  })

  test('a manager gets the People row in the menu — its one door since it left the bar', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    await expect(page.getByText('Signed in as Manager')).toBeVisible()
    // People moved from the bar into this menu (owner call 2026-08-13, during client
    // testing); the old Manage users wording stays gone.
    await expect(page.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
  })

  test('a manager reaching /people directly sees the people screen', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()
  })
})

test.describe('the menu for an admin session', () => {
  test.use({ storageState: STORAGE_STATE.admin })

  test('an admin gets the People row in the menu; Locations stays a bar tab only', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    await expect(page.getByText('Signed in as Admin')).toBeVisible()
    await expect(page.getByRole('link', { name: 'People' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage locations' })).toHaveCount(0)
  })
})

test.describe('logging out on the real API returns to login', () => {
  // No storageState: this describe mints its *own* throwaway session per test (sign in fresh
  // below), so the real POST /auth/logout it fires revokes only that disposable bearer — never
  // the shared persona session the read describes above, or the other live projects, depend on.
  const ELI = FIXTURE_USERS.find((user) => user.key === 'eli')

  // Sign a persona in through the real endpoint for a fresh bearer, then seed it before any app
  // script runs so the SPA boots already signed in on that disposable session (mirrors what the
  // setup does per persona, but inline and throwaway).
  async function seedThrowawaySession(page: Page, request: APIRequestContext): Promise<void> {
    const response = await request.post(`${API_BASE_URL}/auth/sign-in`, {
      data: { email: ELI?.email ?? '', password: FIXTURE_PERSONA_PASSWORDS.eli },
    })
    expect(response.ok(), `throwaway sign-in failed (${response.status()})`).toBeTruthy()
    const { token } = (await response.json()) as { token: string }
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      SESSION_TOKEN_KEY,
      token,
    ] as const)
  }

  test('log out returns the app to login', async ({ page, request }) => {
    await seedThrowawaySession(page, request)
    await page.goto('/tasks')
    await openMenu(page)

    await page.getByRole('button', { name: 'Log out', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })
})
