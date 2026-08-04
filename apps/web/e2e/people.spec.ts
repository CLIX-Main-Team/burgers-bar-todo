import type { UserSummary } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The provisioning and lifecycle slices of /people (U2/U3). Same harness as shell.spec /
// account-menu.spec: the built bundle under preview, the session stubbed at the network
// edge by seeding a bearer and fulfilling /auth/me by role, and the /users list fulfilled
// per role. The list scope is the API's job (ADR-0007); here the stub returns what that
// scope would, and the tests assert the UI wiring — the invite form, the row actions, and
// the gating each audience gets — over that stubbed roster.
//
// The Slice U1 *read* paths (the scoped, sectioned list and the employee bounce) no longer
// live here: they run against the live backbone in people.live.spec.ts (#195), reading the
// real fixture-cast roster the API scopes rather than a stub of it.

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

type Principal = typeof ADMIN | typeof MANAGER

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

// Seed the bearer before any app script runs and fulfil the principal read, so the shell
// mounts as the given role. The provisioning tests that drive a mutating /users (revoke)
// call this and register their own /users route instead of stubSession's static one.
async function seedPrincipal(page: Page, principal: Principal) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
}

async function stubSession(page: Page, principal: Principal, users: unknown[]) {
  await seedPrincipal(page, principal)
  await page.route('**/users', (route) => route.fulfill({ json: { users } }))
}

// The authoritative Location list the admin invite picker now reads (GET /locations, Slice L3),
// retiring the paste-a-UUID field. Named so the picker shows a human branch name, not a raw id.
const LOCATIONS = [
  { id: LOCATION_A, name: 'Downtown' },
  { id: LOCATION_B, name: 'Airport' },
]

// Fulfil the admin-only Location list. Registered before goto so the picker (which fetches on mount
// for an admin) reads it. A manager never fetches it — their branch is fixed — so their tests omit it.
async function stubLocations(page: Page, locations: unknown[]) {
  await page.route('**/locations', (route) => route.fulfill({ json: { locations } }))
}

// ---------------------------------------------------------------------------
// Slice U2 — provisioning (invite / resend / revoke). The invite form and the row
// actions carry over from #35's feature-depth work; this slice assembles them into the
// first-class screen and proves the two audiences each get the shape the API will accept
// (ADR-0007: the UI mirrors the principal, never offering a control the API would reject).
// The endpoints stay the API's job and are not re-tested here (they carry #25's API
// tests); the stubs return what those endpoints would so the UI wiring is what is exercised.

// A pending invite the API would return in a manager's own-Location list. Typed to the
// shared UserSummary so a mistyped override field is a compile error, not a silent stub.
function invitedUser(overrides: Partial<UserSummary>): UserSummary {
  return {
    id: 'c1111111-1111-1111-1111-111111111111',
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'invited',
    preferredLanguage: 'en',
    ...overrides,
  }
}

test('a manager invite form states its fixed remit and sends an Employee at its own Location', async ({
  page,
}) => {
  await stubSession(page, MANAGER, MANAGER_USERS)
  let sentBody: Record<string, unknown> | null = null
  await page.route('**/invites', (route) => {
    sentBody = route.request().postDataJSON() as Record<string, unknown>
    route.fulfill({ json: invitedUser({ email: 'nina@bb.test', displayName: 'Nina New' }) })
  })
  await page.goto('/people')

  await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible()

  // The manager's remit is a stated constraint, not a choice: the fixed-role line is shown,
  // and neither a role nor a Location control is offered (a choice the API would reject).
  await expect(
    page.getByText('New people you invite join as Employees at your Location.'),
  ).toBeVisible()
  await expect(page.getByLabel('Role')).toHaveCount(0)
  await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)

  await page.getByLabel('Email').fill('nina@bb.test')
  await page.getByLabel('Display name').fill('Nina New')
  await page.getByRole('button', { name: 'Send invite', exact: true }).click()

  // A clear confirmation naming the recipient.
  await expect(page.getByText('Invite sent to nina@bb.test.')).toBeVisible()
  // The body the API receives is fixed from the principal, never from a form input: the
  // manager's own Location and the employee role, regardless of what the UI omitted.
  expect(sentBody).toEqual({
    email: 'nina@bb.test',
    displayName: 'Nina New',
    role: 'employee',
    locationId: LOCATION_A,
  })
})

test('an admin invite form offers a Location picker over the real list and invites into the chosen one', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await stubLocations(page, LOCATIONS)
  let sentBody: Record<string, unknown> | null = null
  await page.route('**/invites', (route) => {
    sentBody = route.request().postDataJSON() as Record<string, unknown>
    route.fulfill({ json: invitedUser({ email: 'ivy@bb.test', displayName: 'Ivy Invitee' }) })
  })
  await page.goto('/people')

  // The admin gets the full choice: a role select, and a Location picker for a located role —
  // fed by GET /locations, showing branch names rather than the old paste-a-UUID field.
  await expect(page.getByLabel('Role')).toBeVisible()
  const locationPicker = page.getByLabel('Location', { exact: true })
  await expect(locationPicker).toBeVisible()
  await expect(locationPicker.getByRole('option', { name: 'Downtown' })).toHaveCount(1)
  await expect(locationPicker.getByRole('option', { name: 'Airport' })).toHaveCount(1)

  // Picking a branch by name and inviting an employee sends that Location's id, not a typed uuid.
  await locationPicker.selectOption(LOCATION_B)
  await page.getByLabel('Email').fill('ivy@bb.test')
  await page.getByLabel('Display name').fill('Ivy Invitee')
  await page.getByRole('button', { name: 'Send invite', exact: true }).click()

  await expect(page.getByText('Invite sent to ivy@bb.test.')).toBeVisible()
  expect(sentBody).toEqual({
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_B,
  })
})

test('choosing the admin role drops the Location picker and invites a Location-less admin', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await stubLocations(page, LOCATIONS)
  let sentBody: Record<string, unknown> | null = null
  await page.route('**/invites', (route) => {
    sentBody = route.request().postDataJSON() as Record<string, unknown>
    route.fulfill({
      json: invitedUser({
        email: 'ola@bb.test',
        displayName: 'Ola Owner',
        role: 'admin',
        locationId: null,
      }),
    })
  })
  await page.goto('/people')

  // Choosing the admin role drops the Location picker — an admin invitee is Location-less.
  await expect(page.getByLabel('Location', { exact: true })).toBeVisible()
  await page.getByLabel('Role').selectOption('admin')
  await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)

  await page.getByLabel('Email').fill('ola@bb.test')
  await page.getByLabel('Display name').fill('Ola Owner')
  await page.getByRole('button', { name: 'Send invite', exact: true }).click()

  await expect(page.getByText('Invite sent to ola@bb.test.')).toBeVisible()
  // An admin invitee carries a null Location, not the empty-string the field defaulted to.
  expect(sentBody).toEqual({
    email: 'ola@bb.test',
    displayName: 'Ola Owner',
    role: 'admin',
    locationId: null,
  })
})

test('with no Locations yet, an admin is prompted to create one but can still invite an Admin', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await stubLocations(page, [])
  let sentBody: Record<string, unknown> | null = null
  await page.route('**/invites', (route) => {
    sentBody = route.request().postDataJSON() as Record<string, unknown>
    route.fulfill({
      json: invitedUser({
        email: 'ola@bb.test',
        displayName: 'Ola Owner',
        role: 'admin',
        locationId: null,
      }),
    })
  })
  await page.goto('/people')

  // Decision 7 — the empty-state: a located role has no branch to pick, so the picker is replaced
  // by a prompt to create one first (linking to /locations), and the invite is blocked until then.
  await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No locations yet.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Create a location' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send invite', exact: true })).toBeDisabled()

  // Inviting another Admin needs no Location, so the screen is never fully blocked.
  await page.getByLabel('Role').selectOption('admin')
  await page.getByLabel('Email').fill('ola@bb.test')
  await page.getByLabel('Display name').fill('Ola Owner')
  await page.getByRole('button', { name: 'Send invite', exact: true }).click()

  await expect(page.getByText('Invite sent to ola@bb.test.')).toBeVisible()
  expect(sentBody).toEqual({
    email: 'ola@bb.test',
    displayName: 'Ola Owner',
    role: 'admin',
    locationId: null,
  })
})

test('revoking an invite refreshes the list so the withdrawn row is read back gone', async ({
  page,
}) => {
  await seedPrincipal(page, MANAGER)

  // The list is read back from the API after the action, not guessed: once the invite is
  // revoked, the very next /users read no longer carries it, and the row is gone.
  let revoked = false
  await page.route('**/invites/*/revoke', (route) => {
    revoked = true
    route.fulfill({ json: { status: 'ok' } })
  })
  await page.route('**/users', (route) =>
    route.fulfill({
      json: {
        users: revoked ? MANAGER_USERS.filter((user) => user.status !== 'invited') : MANAGER_USERS,
      },
    }),
  )
  await page.goto('/people')

  await expect(page.getByText('Ivy Invitee')).toBeVisible()
  await page.getByRole('button', { name: 'Revoke invite' }).click()

  // The row is gone because the refreshed list no longer returns it — not hidden client-side.
  await expect(page.getByText('Ivy Invitee')).toHaveCount(0)
  await expect(page.getByText('No pending invites.')).toBeVisible()
  // The Active user is untouched — only the revoked invite left.
  await expect(page.getByText('Ash Active')).toBeVisible()
})

test('resending an invite completes and refreshes the list from the API', async ({ page }) => {
  await seedPrincipal(page, MANAGER)
  await page.route('**/invites/*/resend', (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.route('**/users', (route) => route.fulfill({ json: { users: MANAGER_USERS } }))
  await page.goto('/people')

  await expect(page.getByText('Ivy Invitee')).toBeVisible()

  // A successful resend re-reads the list from the API (unlike revoke it leaves the row
  // in place — the invite is re-mailed, not withdrawn), so catch the refetch it triggers.
  const refetch = page.waitForRequest('**/users')
  await page.getByRole('button', { name: 'Resend invite' }).click()
  await refetch

  // The invite is still pending afterward, and nothing failed.
  await expect(page.getByText('Ivy Invitee')).toBeVisible()
  await expect(
    page.getByText('That action could not be completed. Refresh and try again.'),
  ).toHaveCount(0)
})

// The three distinguishable invite failures the API can answer with, each mapped to its
// own specific message rather than one generic error (invite-form.tsx onError):
// a duplicate (409), a forbidden pair (403), and a transport failure (the request never
// lands). Driven over one shared flow so every enumerated reason is exercised.
const INVITE_FAILURES = [
  {
    name: 'a duplicate email',
    arrange: (page: Page) =>
      page.route('**/invites', (route) =>
        route.fulfill({ status: 409, json: { error: 'conflict' } }),
      ),
    message: 'That email already has an account or a pending invite.',
  },
  {
    name: 'a forbidden invite',
    arrange: (page: Page) =>
      page.route('**/invites', (route) =>
        route.fulfill({ status: 403, json: { error: 'forbidden' } }),
      ),
    message: 'You are not allowed to create that invite.',
  },
  {
    name: 'an unreachable server',
    arrange: (page: Page) => page.route('**/invites', (route) => route.abort()),
    message: 'Could not reach the server. Please try again.',
  },
] as const

for (const failure of INVITE_FAILURES) {
  test(`a failed invite (${failure.name}) shows its specific reason, not a generic error`, async ({
    page,
  }) => {
    await stubSession(page, MANAGER, MANAGER_USERS)
    await failure.arrange(page)
    await page.goto('/people')

    await page.getByLabel('Email').fill('ivy@bb.test')
    await page.getByLabel('Display name').fill('Ivy Again')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    await expect(page.getByText(failure.message)).toBeVisible()
  })
}

test('a manager sees resend/revoke only on invites the API permits them to act on', async ({
  page,
}) => {
  // A manager's list is every user at their Location (list scope), so it can include a
  // still-pending manager invite an admin created there — but the manager may act only on
  // an employee invite (invite-action scope). The row actions mirror that: buttons on the
  // employee invite, none on the manager invite, so the manager never meets a 404.
  const employeeInvite = invitedUser({})
  const managerInvite = invitedUser({
    id: 'c2222222-2222-2222-2222-222222222222',
    email: 'mona@bb.test',
    displayName: 'Mona Manager',
    role: 'manager',
  })
  await stubSession(page, MANAGER, [employeeInvite, managerInvite])
  await page.goto('/people')

  // Both pending users are in view.
  await expect(page.getByText('Ivy Invitee')).toBeVisible()
  await expect(page.getByText('Mona Manager')).toBeVisible()

  // But exactly one row carries the actions — the employee invite. The manager invite,
  // outside the manager's action scope, shows neither control.
  await expect(page.getByRole('button', { name: 'Resend invite' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Revoke invite' })).toHaveCount(1)
})

// Slice 4 — the three lifecycle row actions lead with their mapped glyph, while the
// unmapped Reactivate stays text-only. The glyphs are decorative (aria-hidden), so each
// button's accessible name is exactly its text — the names every provisioning spec above
// keys off are unchanged. An admin view surfaces all four actions in one screen: resend /
// revoke on the pending invite, deactivate on the active rows, reactivate on the gone one.
test('the lifecycle row actions lead with their glyph; Reactivate stays text-only (Slice 4)', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await page.goto('/people')

  // Each mapped action draws exactly one decorative glyph beside its unchanged label
  // (iconography.md roles resend-invite / revoke-invite / deactivate-user).
  await expect(page.getByRole('button', { name: 'Resend invite' }).locator('svg')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Revoke invite' }).locator('svg')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Deactivate' }).first().locator('svg')).toHaveCount(
    1,
  )

  // Reactivate has no mapped role in iconography.md, so no glyph is invented for it: the
  // button stays text-only, its accessible name still 'Reactivate'.
  const reactivate = page.getByRole('button', { name: 'Reactivate' })
  await expect(reactivate).toBeVisible()
  await expect(reactivate.locator('svg')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Slice U3 — account lifecycle (deactivate / reactivate, admin-only). The row controls
// carry over from #35's feature-depth work; this slice proves the assembled screen's
// lifecycle behaviour: an admin cuts and restores access, and each completed action
// re-reads the list so the user lands in the correct section, while a manager is offered
// neither control. The lifecycle endpoints stay the API's job and are not re-tested here
// (deactivation.test.ts / invite-lifecycle.test.ts cover them under #25); the stubs return
// what those endpoints would, so it is the UI wiring — control placement, refresh, gating —
// that is exercised (ADR-0007: the UI mirrors the principal, the API stays the authority).

// The two status sections a lifecycle action moves a user between. Scoped so a section
// assertion is about the row's placement, not a stray same-text match elsewhere on the
// screen. The heading name is matched loosely because each carries a trailing count span
// ("Active 1"); 'Active' is not a substring of 'Deactivated', so the two stay distinct.
function lifecycleSections(page: Page) {
  return {
    active: page.locator('section').filter({ has: page.getByRole('heading', { name: 'Active' }) }),
    deactivated: page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Deactivated' }) }),
  }
}

test('an admin deactivates an Active user, and the refreshed list moves them to Deactivated', async ({
  page,
}) => {
  await seedPrincipal(page, ADMIN)

  // The new section is read back from the API, never guessed: the deactivate call flips the
  // status server-side, so the very next /users read returns the user deactivated and the row
  // leaves Active for Deactivated.
  let deactivated = false
  const ash = (): UserSummary => ({
    id: 'd1111111-1111-1111-1111-111111111111',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    status: deactivated ? 'deactivated' : 'active',
    preferredLanguage: 'en',
  })
  await page.route('**/users/*/deactivate', (route) => {
    deactivated = true
    route.fulfill({ json: ash() })
  })
  await page.route('**/users', (route) => route.fulfill({ json: { users: [ash()] } }))
  await page.goto('/people')

  const { active, deactivated: deactivatedSection } = lifecycleSections(page)

  // Before: Ash is Active and offers Deactivate; nobody is Deactivated yet.
  await expect(active.getByText('Ash Active')).toBeVisible()
  await expect(deactivatedSection.getByText('No deactivated people.')).toBeVisible()

  await page.getByRole('button', { name: 'Deactivate' }).click()

  // After the refreshed read: Ash has moved to Deactivated and now offers Reactivate, not
  // Deactivate — the row followed its new status into the right section.
  await expect(deactivatedSection.getByText('Ash Active')).toBeVisible()
  await expect(active.getByText('Ash Active')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reactivate' })).toBeVisible()
})

test('an admin reactivates a Deactivated user, and the refreshed list moves them to Active', async ({
  page,
}) => {
  await seedPrincipal(page, ADMIN)

  let reactivated = false
  const dan = (): UserSummary => ({
    id: 'd2222222-2222-2222-2222-222222222222',
    email: 'dan@bb.test',
    displayName: 'Dan Gone',
    role: 'employee',
    locationId: LOCATION_B,
    status: reactivated ? 'active' : 'deactivated',
    preferredLanguage: 'en',
  })
  await page.route('**/users/*/reactivate', (route) => {
    reactivated = true
    route.fulfill({ json: dan() })
  })
  await page.route('**/users', (route) => route.fulfill({ json: { users: [dan()] } }))
  await page.goto('/people')

  const { active, deactivated: deactivatedSection } = lifecycleSections(page)

  // Before: Dan is Deactivated and offers Reactivate; nobody is Active yet.
  await expect(deactivatedSection.getByText('Dan Gone')).toBeVisible()
  await expect(active.getByText('No active people.')).toBeVisible()

  await page.getByRole('button', { name: 'Reactivate' }).click()

  // After the refreshed read: Dan has moved to Active and now offers Deactivate, not
  // Reactivate.
  await expect(active.getByText('Dan Gone')).toBeVisible()
  await expect(deactivatedSection.getByText('Dan Gone')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reactivate' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Deactivate' })).toBeVisible()
})

test('a manager is offered no deactivate or reactivate control anywhere on the screen', async ({
  page,
}) => {
  // Cutting or restoring access is the admin's alone (ADR-0002 keeps employees status-only,
  // #59 keeps managers out of provisioning-cut). Even with an active and a deactivated user
  // both in the manager's list, neither lifecycle control renders — the UI never offers what
  // the API would reject (ADR-0007), and the API stays the sole authority regardless.
  const activeEmployee: UserSummary = {
    id: 'd3333333-3333-3333-3333-333333333333',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    status: 'active',
    preferredLanguage: 'en',
  }
  const goneEmployee: UserSummary = {
    ...activeEmployee,
    id: 'd4444444-4444-4444-4444-444444444444',
    email: 'dan@bb.test',
    displayName: 'Dan Gone',
    status: 'deactivated',
  }
  await stubSession(page, MANAGER, [activeEmployee, goneEmployee])
  await page.goto('/people')

  // Both users render, so the absence below is a withheld control, not an empty list.
  await expect(page.getByText('Ash Active')).toBeVisible()
  await expect(page.getByText('Dan Gone')).toBeVisible()

  await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Reactivate' })).toHaveCount(0)
})
