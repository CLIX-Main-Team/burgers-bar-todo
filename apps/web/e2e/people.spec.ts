import { capabilitiesFor } from '@burgers/shared'
import type { UserSummary } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The stubbed slices of /people that stay at the browser edge, over The Counter's recut
// surface (round 8): the roster is one flat table (Person / Role / Branch / Open tasks /
// row menu) and inviting opens a Dialog from the toolbar's Invite person button — the
// sectioned list and inline invite card are gone. Same harness as the other stubbed specs:
// the built bundle under preview, the session stubbed at the network edge by seeding a
// bearer and fulfilling /auth/me by role, and the /users list fulfilled per role. The list
// scope is the API's job (ADR-0007); here the stub returns what that scope would, and the
// tests assert the UI wiring — the row actions and the gating each audience gets.
//
// What lives here are the invite failures a real backend cannot produce through the normal
// flow (403-forbidden, transport failure) and the U3 lifecycle slice (deactivate /
// reactivate), both exercised as UI wiring over a stubbed API; the read and mutation happy
// paths run live in people.live.spec.ts.

const LOCATION_A = '22222222-2222-2222-2222-222222222222'
const LOCATION_B = '33333333-3333-3333-3333-333333333333'

const ADMIN = {
  userId: '44444444-4444-4444-4444-444444444444',
  displayName: 'Shahar Adler',
  role: 'admin',
  locationId: null,
  status: 'active',
  capabilities: capabilitiesFor('admin'),
} as const

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  displayName: 'Yael Bar',
  role: 'manager',
  locationId: LOCATION_A,
  status: 'active',
  capabilities: capabilitiesFor('manager'),
} as const

type Principal = typeof ADMIN | typeof MANAGER

const MANAGER_USERS = [
  {
    id: 'a1111111-1111-1111-1111-111111111111',
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
    status: 'invited',
    preferredLanguage: 'en',
  },
  {
    id: 'a2222222-2222-2222-2222-222222222222',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
    status: 'active',
    preferredLanguage: 'en',
  },
]

const ADMIN_USERS = [
  {
    id: 'b0000000-0000-0000-0000-000000000000',
    email: 'ada@bb.test',
    displayName: 'Ada Admin',
    role: 'admin',
    locationId: null,
    locationName: null,
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'b1111111-1111-1111-1111-111111111111',
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
    status: 'invited',
    preferredLanguage: 'en',
  },
  {
    id: 'b2222222-2222-2222-2222-222222222222',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
    status: 'active',
    preferredLanguage: 'en',
  },
  {
    id: 'b4444444-4444-4444-4444-444444444444',
    email: 'dan@bb.test',
    displayName: 'Dan Gone',
    role: 'employee',
    locationId: LOCATION_B,
    locationName: 'Location B',
    status: 'deactivated',
    preferredLanguage: 'en',
  },
]

// Seed the bearer before any app script runs and fulfil the principal read, so the shell
// mounts as the given role. The People screen also reads the board for its Open-tasks
// column, so /tasks is fulfilled empty. The lifecycle tests register their own mutating
// /users route instead of stubSession's static one.
async function seedPrincipal(page: Page, principal: Principal) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
  // The board read is `/tasks?peek=1`, so the glob keeps the wildcard; the more specific
  // `/tasks/seen` route below is registered later and wins for that path.
  await page.route('**/tasks*', (route) => route.fulfill({ json: { tasks: [], lastSeenAt: null } }))
  await page.route('**/tasks/seen', (route) =>
    route.fulfill({ json: { lastSeenAt: new Date().toISOString() } }),
  )
  await page.route('**/locations', (route) => route.fulfill({ json: { locations: [] } }))
}

async function stubSession(page: Page, principal: Principal, users: unknown[]) {
  await seedPrincipal(page, principal)
  await page.route('**/users', (route) => route.fulfill({ json: { users } }))
}

// One roster row, scoped to the desktop table (the hidden phone list would otherwise
// double every text match).
function row(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name })
}

// Inviting opens the Dialog from the toolbar (The Counter): open it, then drive its fields.
async function openInviteDialog(page: Page) {
  await page.getByRole('button', { name: 'Invite person' }).click()
  await expect(page.getByRole('dialog', { name: 'Invite a person' })).toBeVisible()
}

// ---------------------------------------------------------------------------
// Slice U2 — the invite failures kept as stubs, each still mapped to its own specific
// message rather than one generic error (invite-form.tsx onError).
const INVITE_FAILURES = [
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

    await openInviteDialog(page)
    await page.getByLabel('Email').fill('ivy@bb.test')
    await page.getByLabel('Display name').fill('Ivy Again')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    await expect(page.getByText(failure.message)).toBeVisible()
  })
}

// The row actions live in a per-row overflow DropdownMenu behind the table's end column.
// Each row's menu surfaces exactly the actions the acting principal may take on that
// status: an admin's invited row offers Resend + Revoke, its active rows Deactivate, its
// deactivated row Reactivate.
test('an admin row overflow menu surfaces the status-scoped lifecycle actions', async ({
  page,
}) => {
  await stubSession(page, ADMIN, ADMIN_USERS)
  await page.goto('/people')

  // The pending invite (Ivy): Resend + Revoke.
  await row(page, 'Ivy Invitee').getByRole('button', { name: 'Actions for Ivy Invitee' }).click()
  await expect(page.getByRole('menuitem', { name: 'Resend invite' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Revoke invite' })).toBeVisible()
  await page.keyboard.press('Escape')

  // An active user (Ash): Deactivate.
  await row(page, 'Ash Active').getByRole('button', { name: 'Actions for Ash Active' }).click()
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible()
  await page.keyboard.press('Escape')

  // The deactivated user (Dan): Reactivate.
  await row(page, 'Dan Gone').getByRole('button', { name: 'Actions for Dan Gone' }).click()
  await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Slice U3 — account lifecycle (deactivate / reactivate, admin-only) over the flat table:
// the row's status note and menu follow the refreshed read, and a manager is offered
// neither control. The lifecycle endpoints stay the API's job (ADR-0007); the stubs return
// what those endpoints would, so it is the UI wiring that is exercised.

test('an admin deactivates an Active user, and the refreshed row reads back deactivated', async ({
  page,
}) => {
  await seedPrincipal(page, ADMIN)

  let deactivated = false
  const ash = (): UserSummary => ({
    id: 'd1111111-1111-1111-1111-111111111111',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
    status: deactivated ? 'deactivated' : 'active',
    preferredLanguage: 'en',
  })
  await page.route('**/users/*/deactivate', (route) => {
    deactivated = true
    route.fulfill({ json: ash() })
  })
  await page.route('**/users', (route) => route.fulfill({ json: { users: [ash()] } }))
  await page.goto('/people')

  // Before: Ash's row carries no status note and offers Deactivate.
  await expect(row(page, 'Ash Active').getByText('ash@bb.test', { exact: true })).toBeVisible()

  // The action lives in the row's overflow menu; the destructive confirm routes through an
  // AlertDialog, so the write fires only from the dialog's confirm (not the menu row).
  await row(page, 'Ash Active').getByRole('button', { name: 'Actions for Ash Active' }).click()
  await page.getByRole('menuitem', { name: 'Deactivate' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click()

  // After the refreshed read: the row notes the deactivation on its person line, and its
  // menu now offers Reactivate rather than Deactivate.
  await expect(row(page, 'Ash Active').getByText(/· Deactivated/)).toBeVisible()
  await row(page, 'Ash Active').getByRole('button', { name: 'Actions for Ash Active' }).click()
  await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toHaveCount(0)
})

test('an admin reactivates a Deactivated user, and the refreshed row reads back active', async ({
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
    locationName: 'Location B',
    status: reactivated ? 'active' : 'deactivated',
    preferredLanguage: 'en',
  })
  await page.route('**/users/*/reactivate', (route) => {
    reactivated = true
    route.fulfill({ json: dan() })
  })
  await page.route('**/users', (route) => route.fulfill({ json: { users: [dan()] } }))
  await page.goto('/people')

  // Before: Dan's row notes the deactivation and offers Reactivate (a direct action, no
  // destructive confirm).
  await expect(row(page, 'Dan Gone').getByText(/· Deactivated/)).toBeVisible()
  await row(page, 'Dan Gone').getByRole('button', { name: 'Actions for Dan Gone' }).click()
  await page.getByRole('menuitem', { name: 'Reactivate' }).click()

  // After the refreshed read: the note is gone and the menu offers Deactivate.
  await expect(row(page, 'Dan Gone').getByText(/· Deactivated/)).toHaveCount(0)
  await row(page, 'Dan Gone').getByRole('button', { name: 'Actions for Dan Gone' }).click()
  await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Reactivate' })).toHaveCount(0)
})

test('a manager is offered no deactivate or reactivate control anywhere on the screen', async ({
  page,
}) => {
  // Cutting or restoring access is the admin's alone. Even with an active and a deactivated
  // user both in the manager's list, neither lifecycle control renders — the UI never offers
  // what the API would reject (ADR-0007).
  const activeEmployee: UserSummary = {
    id: 'd3333333-3333-3333-3333-333333333333',
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: LOCATION_A,
    locationName: 'Location A',
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
  await expect(row(page, 'Ash Active').first()).toBeVisible()
  await expect(row(page, 'Dan Gone').first()).toBeVisible()

  // A manager gets no lifecycle control: neither row carries an overflow menu at all.
  await expect(page.getByRole('button', { name: 'Actions for Ash Active' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Actions for Dan Gone' })).toHaveCount(0)
})
