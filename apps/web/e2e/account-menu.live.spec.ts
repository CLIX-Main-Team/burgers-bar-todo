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
// (manager), Eli (employee). Identity (the "Signed in as" label over the bold role) reads
// the principal's role, so each describe's persona is exactly the role its assertions
// expect.
//
// "Log out of all devices" is GONE from the menu since The Counter (round 8, owner call rev
// 2) — one quiet Log out is the menu's only session action, exercised live here on a
// throwaway session signed in fresh so revoking it leaves the shared persona session intact.
//
// This is the phone shell's account menu, so the whole file pins a phone viewport. The menu
// carries settings, the role-gated Users and Access rows, and logout.
//
// The panel became More on 2026-08-30. The phone's bar is capped at five cells, four
// destinations plus this trigger, so whatever a role holds beyond the fourth is listed here
// above the management rows. Which destinations those are is positional and depends on what the
// Access page grants that role, so this asserts the rule for an admin rather than a fixed list.
// On desktop nothing moved: the rail carries every destination and this panel is still
// settings-only (shell.spec.ts).
test.use({ viewport: { width: 390, height: 720 } })

// The phone bar's last cell is More, not Account: it opens one sheet carrying the overflow
// destinations, the management rows AND the settings, so "Account" would name a third of what
// is behind it. Its accessible name matches the word printed under the glyph, which is the rule
// (WCAG 2.5.3). The desktop rail's foot is still Account and shell.spec.ts still opens it by
// that name — the two triggers are never on screen at the same width.
async function openMenu(page: Page) {
  await page.getByRole('button', { name: 'More' }).click()
}

test.describe('the menu for an employee session', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('shows identity, language, and the one quiet logout', async ({ page }) => {
    await page.goto('/tasks')
    await openMenu(page)

    // Read-only identity: the label line over the bold role we have from /auth/me, scoped
    // by testid — the bare role word also lives in the (hidden) desktop nav foot.
    await expect(page.getByTestId('account-identity')).toContainText('Signed in as')
    await expect(page.getByTestId('account-identity')).toContainText('Employee')
    // The language toggle, under its LANGUAGE overline.
    await expect(page.getByRole('button', { name: 'עברית' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
    // One Log out — "log out of all devices" is gone (The Counter, rev 2 owner call).
    await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log out of all devices' })).toHaveCount(0)
    // No Users entry for an employee.
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
  })

  test('the avatar trigger draws its glyph through the registry without losing its name', async ({
    page,
  }) => {
    await page.goto('/tasks')

    // The hand-rolled inline svg is gone: the trigger draws two decorative <Icon> svgs —
    // the account glyph in its circle plus the settings gear (v2 rail; the gear is CSS-hidden
    // at the phone measure but stays in the DOM) — while its accessible name — the thing a
    // screen-reader announces — stays 'Account' (Slice 2, iconography.md).
    const trigger = page.getByRole('button', { name: 'More' })
    await expect(trigger.locator('svg')).toHaveCount(2)
    await expect(trigger.locator('svg:visible')).toHaveCount(1)
  })

  test('the language toggle is a bare text segment control (The Counter recut)', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    // The leading translate glyph went with the recut — the LANGUAGE overline names the
    // control now, and the fieldset keeps its accessible name for assistive tech.
    await expect(page.getByRole('group', { name: 'Language' }).locator('svg')).toHaveCount(0)
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

  test('navigating directly to /people is redirected to the board', async ({ page }) => {
    await page.goto('/people')

    // The guard bounces to the first page the role holds. For an employee that is the board
    // again since 2026-08-25, when the dashboard became a branch-runner's screen.
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  })
})

test.describe('the menu for a manager session', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('the menu items carry their leading glyphs', async ({ page }) => {
    await page.goto('/tasks')
    await openMenu(page)

    // The one session action leads with one decorative sign-out glyph, named by the item's
    // own text, not the icon.
    await expect(
      page.getByRole('button', { name: 'Log out', exact: true }).locator('svg'),
    ).toHaveCount(1)
  })

  test('a manager gets the Users row in the panel, its one door since it left the rail', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    await expect(page.getByTestId('account-identity')).toContainText('Manager')
    // Users moved from the rail into this panel (owner call 2026-08-13, during client
    // testing); the old Manage users wording stays gone.
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage users' })).toHaveCount(0)
  })

  test('a manager reaching /people directly sees the people screen', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  })
})

test.describe('the menu for an admin session', () => {
  test.use({ storageState: STORAGE_STATE.super_admin })

  test('an admin gets Users, Access and Locations as the panel’s management rows', async ({
    page,
  }) => {
    await page.goto('/tasks')
    await openMenu(page)

    await expect(page.getByTestId('account-identity')).toContainText('Admin')
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    // Held back from the bottom bar for want of a slot, so the panel is its way in on a phone.
    await expect(page.getByRole('link', { name: 'Locations' })).toBeVisible()
    // And it is genuinely absent from the bar rather than merely duplicated into the panel.
    await expect(
      page.getByTestId('bottom-tabs').getByRole('link', { name: 'Locations' }),
    ).toHaveCount(0)
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
