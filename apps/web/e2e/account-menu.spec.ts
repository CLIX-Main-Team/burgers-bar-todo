import { type Page, expect, test } from '@playwright/test'

// One account-menu test stays stubbed: `log out of all devices`. On the live backbone every
// other account-menu test moved to account-menu.live.spec.ts (#197), but logout-all revokes
// *every* session the user holds — which on a real API would kill the shared persona bearer the
// other live projects (session.live, shell.live, people.live) run against in parallel. There is
// no spare loginable persona to sacrifice, so this one action is exercised here, against a stub
// that fulfils /auth/me and succeeds the logout-all call, proving the client's own
// return-to-login wiring without touching real session state. (Single-device `log out` *is*
// live — it revokes only a throwaway session — see account-menu.live.spec.ts.)
//
// This is the mobile shell's header menu, so pin a phone viewport: the desktop shell (≥ md)
// promotes People/Locations to side-nav rows and drops them from the account foot (covered,
// stubbed, in shell.spec's desktop block).
test.use({ viewport: { width: 390, height: 720 } })

// A single manager principal — the one role this remaining test needs.
const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'manager',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
} as const

// Seed the bearer before any app script runs and fulfil the principal read plus the people
// list — a manager's /tasks eagerly reads /users (the writer-scoped assignee list). The
// logout-all endpoint is stubbed to succeed so the wiring under test is the client's own
// return-to-login, not the API's.
async function stubSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: MANAGER }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
  await page.route('**/auth/logout-all', (route) => route.fulfill({ json: { ok: true } }))
}

test('log out of all devices asks first, and confirming returns the app to login', async ({
  page,
}) => {
  await stubSession(page)
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Account' }).click()

  // The menu row no longer acts on its own — it opens the confirmation (the misclick guard,
  // owner call 2026-08). The menu closes behind it, so the dialog's confirm is then the only
  // button carrying the action's name.
  await page.getByRole('button', { name: 'Log out of all devices' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Log out of all devices?' })
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'Log out of all devices' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('cancelling the confirmation keeps the session', async ({ page }) => {
  await stubSession(page)
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Account' }).click()
  await page.getByRole('button', { name: 'Log out of all devices' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Log out of all devices?' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible()

  // Still signed in, still on the board — the stray tap cost nothing.
  await expect(page).toHaveURL(/\/tasks$/)
})
