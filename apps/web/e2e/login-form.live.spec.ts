import { expect, test } from '@playwright/test'
import { FIXTURE_PERSONA_PASSWORDS, FIXTURE_USERS } from '../../api/test/helpers/fixture-cast.js'

// The one test that drives the real login *form* end to end (the rest of the live lane opens
// with a saved session; part of #151). No storageState — this project starts anonymous, so
// RequireAnon lets the login screen render. Typing a persona's credentials and submitting
// exercises the whole path the setup project short-circuits: the form → POST /auth/sign-in on
// the live API → bearer stored → the app enters behind RequireAuth and redirects to /dashboard.
//
// Mia the manager is an arbitrary persona choice; any of the three would do. Her email and
// password come from the fixture cast so this can never drift from what the setup seeded.
const MIA = FIXTURE_USERS.find((user) => user.key === 'mia')

test('a persona signs in through the real login form and lands in the app', async ({ page }) => {
  const email = MIA?.email ?? ''

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(FIXTURE_PERSONA_PASSWORDS.mia)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // A real session lands on the app, not back on login with the generic failure alert. Mia is a
  // manager, and a manager's first destination is the board since 2026-08-25 — the dashboard
  // became a branch-runner's screen.
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
})
