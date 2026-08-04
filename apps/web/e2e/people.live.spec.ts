import { expect, test } from '@playwright/test'
import { FIXTURE_LOCATION_IDS } from '../../api/test/helpers/fixture-cast.js'
import { STORAGE_STATE } from './env.js'

// The read paths of the /people list, proven through the browser against the live backbone
// (#195, part of #151). Where the stubbed people.spec.ts fulfils /auth/me and /users at the
// network edge to fake each audience, these open with a *real* persona session (the bearer the
// setup minted, attached per-role below) and read the *real* /users roster the API scopes from
// that principal (ADR-0007). Nothing here mutates: every assertion reads the read-only fixture
// cast, so the specs are inherently parallel- and retry-safe — a re-run reads the same eight
// seeded rows. The list *scope* is the API's job; what each test asserts is the presentation
// the scoped roster produces — a manager's own-Location single-section-shape list, an admin's
// chain-wide list with a Location column and filter, and an employee bounced off the surface.
//
// The eight seeded rows (loadFixtureCast, #193), by the two Locations that matter here:
//   Location A: Mia (manager, active), Eli (employee, active), Ash (employee, active),
//               Ivy (employee, invited), Mona (manager, invited)
//   Location B: Ben (employee, active), Dan (employee, deactivated)
//   no Location: Ada (admin, active) — the chain-wide principal
const LOCATION_A = FIXTURE_LOCATION_IDS.a
const LOCATION_B = FIXTURE_LOCATION_IDS.b

test.describe('a manager reads their own-Location roster', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('own-Location, un-columned, three sections, no Location filter', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

    // All three sections are present, populated by the API's own-Location scope.
    await expect(page.getByRole('heading', { name: 'Invited' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Deactivated' })).toBeVisible()

    // A row carries display name and email; each seeded Location-A user lands in its section.
    await expect(page.getByText('Ivy Invitee')).toBeVisible()
    await expect(page.getByText('ivy@bb.test')).toBeVisible()
    await expect(page.getByText('Ash Active')).toBeVisible()

    // Location A seeds no deactivated user, so that section reads as an explicit empty state.
    await expect(page.getByText('No deactivated people.')).toBeVisible()

    // Cross-Location rows never reach a manager: Ben (Location B) and Ada (chain-wide) are
    // outside the API's own-Location scope, so they are simply absent from the roster.
    await expect(page.getByText('Ben Bee')).toHaveCount(0)
    await expect(page.getByText('Ada Admin')).toHaveCount(0)

    // No Location column and no filter for a single-Location remit: neither the filter control
    // nor the Location value appears anywhere on a manager's screen.
    await expect(page.getByLabel('Filter by location')).toHaveCount(0)
    await expect(page.getByText(LOCATION_A)).toHaveCount(0)
  })
})

test.describe('an admin reads the chain-wide roster', () => {
  test.use({ storageState: STORAGE_STATE.admin })

  test('chain-wide, Location column, working filter incl. clear-to-all', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

    // Three sections, populated from across the chain.
    await expect(page.getByRole('heading', { name: 'Invited' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Deactivated' })).toBeVisible()

    // The Location column: a real Location id shows on a row, and the location-less admin reads
    // as "Chain-wide" rather than a blank cell. Scope to the sections so the match is the row's
    // column, not the (visually identical) filter <option> carrying the same text.
    const sections = page.locator('section')
    await expect(sections.getByText(LOCATION_B).first()).toBeVisible()
    await expect(sections.getByText('Chain-wide').first()).toBeVisible()

    // The whole seeded chain is in view before filtering: users at both Locations and the
    // chain-wide admin herself.
    await expect(page.getByText('Ben Bee')).toBeVisible()
    await expect(page.getByText('Dan Gone')).toBeVisible()
    await expect(page.getByText('Ada Admin')).toBeVisible()

    // Filtering to Location A narrows to that Location: its users stay, every other Location's
    // users (and the chain-wide admin) drop out.
    await page.getByLabel('Filter by location').selectOption(LOCATION_A)
    await expect(page.getByText('Ivy Invitee')).toBeVisible()
    await expect(page.getByText('Ash Active')).toBeVisible()
    await expect(page.getByText('Ben Bee')).toHaveCount(0)
    await expect(page.getByText('Dan Gone')).toHaveCount(0)
    await expect(page.getByText('Ada Admin')).toHaveCount(0)
    // Location B's only deactivated user (Dan) is filtered out, so that section reads as empty.
    await expect(page.getByText('No deactivated people.')).toBeVisible()

    // Clearing the filter restores the chain-wide view.
    await page.getByLabel('Filter by location').selectOption('all')
    await expect(page.getByText('Ben Bee')).toBeVisible()
    await expect(page.getByText('Dan Gone')).toBeVisible()
  })
})

test.describe('an employee is bounced off /people', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('a direct link to /people lands on the task board, no provisioning surface', async ({
    page,
  }) => {
    await page.goto('/people')

    // Presentation gating bounces the employee to the task board (RequireProvisioner); the
    // people screen — its heading and its invite form — never renders. The API is the real
    // boundary (ADR-0007); here we assert the surface is simply absent on a real session.
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'People' })).toHaveCount(0)
    await expect(page.getByText('Invite someone')).toHaveCount(0)
  })
})
