import { expect, test } from '@playwright/test'

// The redesigned pre-auth frame (issue #123, map #116; recut to the front-door embrace,
// auth round 2026-08-27). Same harness as the other web specs: the built bundle under
// `vite preview`. Unlike the shell specs these routes are reachable unauthenticated, so no
// session stub is needed. The frame is verified only by its externally observable
// behaviour — that the branded frame and wordmark are present on every pre-auth route,
// that the embrace decoration is a desktop-only move, that the frame mirrors by
// direction, and that the form stays operable. Visual fidelity (the board, the gradient
// embrace, exact pixels, the entrance) is checked by design review, not asserted here.

// The wordmark's alt text is the app name; in the default (English) locale it is this.
const APP_NAME = 'Burgers Bar'

// Every pre-auth route renders through the shared AuthLayout: login, accept, the two
// reset screens, plus the token-error and confirmation states that still sit in the frame.
const ROUTES = [
  { name: 'login', path: '/login' },
  // /accept with no token renders the missing-token error state, still framed.
  { name: 'accept (missing-token error)', path: '/accept' },
  { name: 'reset-request', path: '/reset' },
  // /reset with a token renders reset-consume's form state.
  { name: 'reset-consume', path: '/reset?token=demo-token' },
]

for (const route of ROUTES) {
  test(`renders the branded frame on ${route.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(route.path)

    // The branded frame is present and the wordmark that names the brand is visible.
    // Asserted via the wordmark's accessible name, not styles.
    await expect(page.getByTestId('auth-front-door')).toBeVisible()
    await expect(page.getByRole('img', { name: APP_NAME })).toBeVisible()
  })
}

test('shows the bracket embrace at a desktop width and folds it away on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/login')

  // Desktop: the frame carries the embrace decoration around the card.
  await expect(page.getByTestId('auth-front-door')).toBeVisible()
  await expect(page.getByTestId('auth-embrace')).toBeVisible()

  // Phone: the same single-column frame, with the embrace folded away.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('auth-front-door')).toBeVisible()
  await expect(page.getByTestId('auth-embrace')).toBeHidden()
})

test('the language toggle mirrors the whole frame by flipping document direction and lang', async ({
  page,
}) => {
  await page.goto('/login')

  // Choosing Hebrew stamps rtl/he on the root, its native direction.
  await page.getByRole('button', { name: 'עברית' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'he')

  // Choosing English mirrors it back to ltr/en.
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('keeps the sign-in form operable and keyboard-focusable', async ({ page }) => {
  await page.goto('/login')

  const email = page.getByLabel('Email')
  const password = page.getByLabel('Password')
  const submit = page.getByRole('button', { name: 'Sign in' })
  const toggle = page.getByRole('button', { name: 'English' })

  await expect(email).toBeVisible()
  await expect(password).toBeVisible()
  await expect(submit).toBeVisible()

  // Each control takes keyboard focus — the observable proxy for a reachable field with a
  // visible focus ring (the ring itself is a token, not asserted here per the test notes).
  await email.focus()
  await expect(email).toBeFocused()
  await password.focus()
  await expect(password).toBeFocused()
  await submit.focus()
  await expect(submit).toBeFocused()
  await toggle.focus()
  await expect(toggle).toBeFocused()
})

test('the reset-request confirmation state stays inside the branded frame', async ({ page }) => {
  // Stub the non-enumerating acknowledgement so the confirmation renders without a live API.
  await page.route('**/auth/reset-request', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/reset')

  await page.getByLabel('Email').fill('someone@burgers.co')
  await page.getByRole('button', { name: 'Send reset link' }).click()

  // The generic confirmation appears and it is still wrapped in the branded frame.
  await expect(
    page.getByText('If an account exists for that address, a reset link is on its way.'),
  ).toBeVisible()
  await expect(page.getByTestId('auth-front-door')).toBeVisible()
  await expect(page.getByRole('img', { name: APP_NAME })).toBeVisible()
})
