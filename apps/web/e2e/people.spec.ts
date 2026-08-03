import { type Page, expect, test } from '@playwright/test'

// Slice U1 — the scoped, sectioned /people list. Same harness as shell.spec /
// account-menu.spec: the built bundle under preview, the session stubbed at the network
// edge by seeding a bearer and fulfilling /auth/me by role, and the /users list fulfilled
// per role so the audience-shaped list (a manager's un-columned single-Location list, an
// admin's chain-wide list with a Location column and filter) is exercised without a live
// API. The list scope is the API's job (ADR-0007); here the stub returns what that scope
// would, and the test asserts the presentation the two audiences each get.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'
const LOCATION_B = '33333333-3333-3333-3333-333333333333'

const ADMIN = {
  userId: '44444444-4444-4444-4444-444444444444',
  role: 'admin',
  locationId: null,
  status: 'active',
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
} as const

const EMPLOYEE = {
  userId: '55555555-5555-5555-5555-555555555555',
  role: 'employee',
  locationId: LOCATION_A,
  status: 'active',
} as const

type Principal = typeof ADMIN | typeof MANAGER | typeof EMPLOYEE

// A manager's list as the API would scope it: only their own Location, and here with no
// deactivated user so that section proves an empty section reads as an explicit state.
const MANAGER_USERS = [
  {
    id: 'a1111111-1111-1111-1111-111111111111',
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'invited',
    preferredLanguage: 'en',
  },
  {
    id: 'a2222222-2222-2222-2222-222222222222',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  },
]

// An admin's chain-wide list: users across two Locations plus a location-less admin, and
// one user in each status so all three sections and the Location filter can be driven.
const ADMIN_USERS = [
  {
    id: 'b0000000-0000-0000-0000-000000000000',
    email: 'ada@bb.test',
    displayName: 'Ada Admin',
    role: 'admin',
    locationId: null,
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'b1111111-1111-1111-1111-111111111111',
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'invited',
    preferredLanguage: 'en',
  },
  {
    id: 'b2222222-2222-2222-2222-222222222222',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'b3333333-3333-3333-3333-333333333333',
    email: 'ben@bb.test',
    displayName: 'Ben Bee',
    role: 'employee',
    locationId: LOCATION_B,
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'b4444444-4444-4444-4444-444444444444',
    email: 'dan@bb.test',
    displayName: 'Dan Gone',
    role: 'employee',
    locationId: LOCATION_B,
    status: 'deactivated',
    preferredLanguage: 'en',
  },
]

async function stubSession(page: Page, principal: Principal, users: unknown[]) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  await page.route('**/users', (route) => route.fulfill({ json: { users } }))
}

test('a manager sees an own-location, un-columned, three-section list', async ({ page }) => {
  await stubSession(page, MANAGER, MANAGER_USERS)
  await page.goto('/people')

  await expect(page).toHaveURL(/\/people$/)
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

  // All three sections are present, and each user lands in the right one.
  await expect(page.getByRole('heading', { name: 'Invited' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Deactivated' })).toBeVisible()

  // A row carries display name, email, role, and status.
  await expect(page.getByText('Ivy Invitee')).toBeVisible()
  await expect(page.getByText('ivy@bb.test')).toBeVisible()
  await expect(page.getByText('Ash Active')).toBeVisible()

  // The empty Deactivated section reads as an explicit state, not a vanished section.
  await expect(page.getByText('No deactivated people.')).toBeVisible()

  // No Location column and no filter for a single-Location remit: neither the filter
  // control nor the Location value appears anywhere on a manager's screen.
  await expect(page.getByLabel('Filter by location')).toHaveCount(0)
  await expect(page.getByText(LOCATION_A)).toHaveCount(0)
})

test('an admin sees a chain-wide list with a Location column and a working filter', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await page.goto('/people')

  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible()

  // Three sections, populated from across the chain.
  await expect(page.getByRole('heading', { name: 'Invited' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Deactivated' })).toBeVisible()

  // The Location column: a real Location id shows on a row, and the location-less admin
  // reads as "Chain-wide" rather than a blank cell. Scope to the sections so the match is
  // the row's column, not the (visually hidden) filter <option> carrying the same text.
  const sections = page.locator('section')
  await expect(sections.getByText(LOCATION_B).first()).toBeVisible()
  await expect(sections.getByText('Chain-wide').first()).toBeVisible()

  // Everyone is in view before filtering.
  await expect(page.getByText('Ben Bee')).toBeVisible()
  await expect(page.getByText('Dan Gone')).toBeVisible()
  await expect(page.getByText('Ada Admin')).toBeVisible()

  // Filtering to Location A narrows to that Location: its users stay, every other
  // Location's users (and the chain-wide admin) drop out.
  await page.getByLabel('Filter by location').selectOption(LOCATION_A)
  await expect(page.getByText('Ivy Invitee')).toBeVisible()
  await expect(page.getByText('Ash Active')).toBeVisible()
  await expect(page.getByText('Ben Bee')).toHaveCount(0)
  await expect(page.getByText('Dan Gone')).toHaveCount(0)
  await expect(page.getByText('Ada Admin')).toHaveCount(0)
  // With Location B's only deactivated user filtered out, that section reads as empty.
  await expect(page.getByText('No deactivated people.')).toBeVisible()

  // Clearing the filter restores the chain-wide view.
  await page.getByLabel('Filter by location').selectOption('all')
  await expect(page.getByText('Ben Bee')).toBeVisible()
})

test('an employee reaching /people by direct link sees no provisioning surface', async ({
  page,
}) => {
  await stubSession(page, EMPLOYEE, ADMIN_USERS)
  await page.goto('/people')

  // Presentation gating bounces the employee to the task board (RequireProvisioner); the
  // people screen — its heading and its roster — never renders. The API is the real
  // boundary (ADR-0007); here we assert the surface is simply absent.
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByRole('heading', { name: 'People' })).toHaveCount(0)
  await expect(page.getByText('Invite someone')).toHaveCount(0)
})
