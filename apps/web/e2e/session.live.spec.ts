import { expect, test } from '@playwright/test'

// The live lane's proof that a saved session is a *real* one (part of #151). This spec runs
// once per persona — the live-super-admin, live-manager, and live-employee projects each attach the
// storageState the setup wrote for that role — so it is deliberately role-agnostic: it asserts
// only what every signed-in principal shares.
//
// Opening `/` with the persona's bearer already in localStorage makes the SPA read /auth/me
// against the live API; a real principal comes back, RequireAuth admits it, and the index
// redirects to /dashboard behind the shell. A stub could fake the /auth/me shape — only a live
// API backed by the seeded row returns a principal here, which is the whole point of the
// backbone.
test('a saved persona session boots straight into the authenticated app', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})
