import { capabilitiesFor } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The Profile page (2026-09-04): a person picks the colour of their own disc and the choice
// reaches the chrome. Stubbed at the network edge like the rest of the shell specs — a bearer
// is seeded into storage, /auth/me answers a principal, and the PATCH answers the principal it
// would have written. What is under test is the client's own loop: pick a swatch, save, and see
// the account foot repaint from the response without a reload.

const PERSON = {
  userId: '44444444-4444-4444-4444-444444444444',
  displayName: 'Noa Levi',
  email: 'noa@burgers.local',
  avatarTone: null as number | null,
  locationId: '22222222-2222-2222-2222-222222222222',
  locationName: 'Dizengoff',
  status: 'active',
  role: 'employee',
  capabilities: capabilitiesFor('employee'),
} as const

// The disc is aria-hidden by design (the name beside it carries the meaning), so it is reached
// by its shape rather than by a role: the initials span carrying one of the eight person tones.
const DISC = 'span[aria-hidden][dir="auto"]'

// A swatch is a visually-hidden radio inside a label that draws the disc, which is the standard
// accessible pattern: the label is what takes the pointer, and the radio is what the keyboard and
// the screen reader see. So a test clicks the LABEL, the way a person does — clicking the input
// itself fails on its own label intercepting the event, which is the pattern working, not a bug.
const swatch = (page: Page, name: string) =>
  page.locator('label', { has: page.getByRole('radio', { name, exact: true }) })

async function stubSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  let stored: number | null = null
  await page.route('**/auth/me', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { avatarTone?: number | null }
      if (body.avatarTone !== undefined) stored = body.avatarTone
      return route.fulfill({ json: { ...PERSON, avatarTone: stored } })
    }
    return route.fulfill({ json: { ...PERSON, avatarTone: stored } })
  })
  await page.route('**/users', (route) => route.fulfill({ json: { users: [] } }))
  await page.route('**/tasks**', (route) => route.fulfill({ json: { tasks: [] } }))
}

test.describe('profile', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the account popover carries a Profile row that opens the page', async ({ page }) => {
    await stubSession(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Account' }).click()
    const profileRow = page.getByRole('link', { name: 'Profile' })
    await expect(profileRow).toBeVisible()
    await profileRow.click()

    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  })

  test('the account block shows the person read-only, never as fields to edit', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/profile')

    // Email, role and branch are an admin's to change, so they are stated, not offered.
    await expect(page.getByText('noa@burgers.local')).toBeVisible()
    await expect(page.getByText('Dizengoff')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)
  })

  test('picking a colour and saving repaints the account foot without a reload', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/profile')

    // Nothing is stored until Save, so the button stays inert until something is actually
    // different from what the principal already says.
    const save = page.getByRole('button', { name: 'Save changes' })
    await expect(save).toBeDisabled()

    await swatch(page, 'Colour 6').click()
    await expect(page.getByRole('radio', { name: 'Colour 6', exact: true })).toBeChecked()
    await expect(save).toBeEnabled()

    await save.click()
    await expect(page.getByText('Saved.')).toBeVisible()

    // The write answered with the fresh principal, so the disc at the foot of the rail wears
    // the new colour with no second fetch and no reload.
    const accountDisc = page.getByRole('button', { name: 'Account' }).locator(DISC)
    await expect(accountDisc).toHaveClass(/bg-person-6/)
  })

  test('automatic keeps the colour hashed from the name rather than storing one', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/profile')

    await swatch(page, 'Colour 3').click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Saved.')).toBeVisible()

    await swatch(page, 'Automatic').click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Automatic, from your name')).toBeVisible()

    // Back to a hashed tone: some person colour, and not the one that was stored.
    const accountDisc = page.getByRole('button', { name: 'Account' }).locator(DISC)
    await expect(accountDisc).toHaveClass(/bg-person-[1-8]/)
    await expect(accountDisc).not.toHaveClass(/bg-person-3\b/)
  })

  test('the password form asks for the current one and refuses a mismatched confirmation', async ({
    page,
  }) => {
    await stubSession(page)
    await page.goto('/profile')

    await page.getByLabel('Current password').fill('whatever-it-is')
    await page.getByLabel('New password', { exact: true }).fill('a-long-enough-password')
    await page.getByLabel('Confirm new password').fill('a-different-password')

    let called = false
    await page.route('**/auth/change-password', (route) => {
      called = true
      return route.fulfill({ json: { status: 'ok' } })
    })
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect(page.getByText('The two passwords do not match.')).toBeVisible()
    expect(called).toBe(false)
  })
})
