import { expect, test } from '@playwright/test'

// The live lane's proof that a saved session is a *real* one (part of #151). This spec runs
// once per persona — the live-super-admin, live-manager, and live-employee projects each attach the
// storageState the setup wrote for that role — so it is deliberately role-agnostic: it asserts
// only what every signed-in principal shares.
//
// Opening `/` with the persona's bearer already in localStorage makes the SPA read /auth/me
// against the live API; a real principal comes back, RequireAuth admits it, and the index
// redirects to the first page that principal's role holds. A stub could fake the /auth/me shape
// — only a live API backed by the seeded row returns a principal here, which is the whole point
// of the backbone.
//
// Which page that is became role-dependent on 2026-08-25, when the dashboard became a
// branch-runner's screen: the owner and a branch admin land on it, a manager and an employee on
// their board. The assertion follows the rail rather than naming a path, which keeps this spec
// role-agnostic the way the three projects need it to be.
test('a saved persona session boots straight into the authenticated app', async ({ page }) => {
  await page.goto('/')

  const nav = page.getByRole('navigation', { name: 'Primary' })
  await expect(nav).toBeVisible()
  // Landed on a real destination — the first row of this principal's own rail — rather than on
  // login or on a redirect loop.
  await expect(page).toHaveURL(/\/(dashboard|tasks)$/)
  await expect(nav.getByRole('link').first()).toHaveAttribute('aria-current', 'page')
})
