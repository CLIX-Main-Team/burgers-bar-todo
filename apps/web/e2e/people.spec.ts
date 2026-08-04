import type { UserSummary } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The stubbed slices of /people that stay at the browser edge. Same harness as shell.spec /
// account-menu.spec: the built bundle under preview, the session stubbed at the network edge
// by seeding a bearer and fulfilling /auth/me by role, and the /users list fulfilled per role.
// The list scope is the API's job (ADR-0007); here the stub returns what that scope would, and
// the tests assert the UI wiring — the row actions and the gating each audience gets — over
// that stubbed roster.
//
// The provisioning *read* paths (the scoped, sectioned list, the employee bounce), and the
// invite *mutation* paths (real invite / 409 / revoke / resend / action-scope) no longer live
// here: they run against the live backbone in people.live.spec.ts (#195, #196), driving the real
// endpoints rather than a stub of them. What stays here are the invite failures a real backend
// cannot produce through the normal flow (403-forbidden, transport failure) and the U3 lifecycle
// slice (deactivate / reactivate), both still exercised as UI wiring over a stubbed API.

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
// mounts as the given role. The lifecycle tests that drive a mutating /users (deactivate /
// reactivate) call this and register their own /users route instead of stubSession's static one.
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

// ---------------------------------------------------------------------------
// Slice U2 — the invite failures kept as stubs. The successful invite paths and the live 409
// moved to people.live.spec.ts (#196); what remains here are the two failures a real backend
// cannot produce through the normal flow, each still mapped to its own specific message rather
// than one generic error (invite-form.tsx onError): a forbidden pair (403) — the manager UI
// offers no control to send one — and a transport failure (the request never lands) — a running
// server has no unreachable-mid-test equivalent. Driven over one shared flow.
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

    await page.getByLabel('Email').fill('ivy@bb.test')
    await page.getByLabel('Display name').fill('Ivy Again')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    await expect(page.getByText(failure.message)).toBeVisible()
  })
}

// Slice 4 — the three lifecycle row actions lead with their mapped glyph, while the
// unmapped Reactivate stays text-only. The glyphs are decorative (aria-hidden), so each
// button's accessible name is exactly its text — the names every provisioning spec keys
// off are unchanged. An admin view surfaces all four actions in one screen: resend /
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
