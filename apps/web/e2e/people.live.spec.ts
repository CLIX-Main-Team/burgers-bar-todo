import { type Locator, type Page, type TestInfo, expect, test } from '@playwright/test'
import { FIXTURE_LOCATION_IDS } from '../../api/test/helpers/fixture-cast.js'
import { STORAGE_STATE } from './env.js'

// The /people list against the live backbone (#151): the read paths (#195) and the mutation
// paths (#196), each proven through the browser against the *real* API on Postgres. Where the
// stubbed people.spec.ts fulfils /auth/me, /users, and /invites at the network edge to fake each
// audience, these open with a *real* persona session (the bearer the setup minted, attached
// per-role below) and drive the *real* invite endpoints the API scopes from that principal
// (ADR-0007).
//
// Two kinds of test live here. The **read** paths read the read-only fixture cast, so they are
// inherently parallel- and retry-safe — a re-run reads the same eight seeded rows. The
// **mutation** paths each create their *own* uniquely-keyed invite (keyed to test + worker +
// attempt, `uniqueEmail` below) and assert on that one row, never on the shared baseline, so
// `fullyParallel` stays on and a retry never collides on state a prior attempt left behind.
//
// What stays stubbed (in people.spec.ts, the chromium project) are the two invite failures a
// real backend cannot produce through the normal flow: the **403-forbidden** invite (the manager
// UI offers no control to send a forbidden request) and the **transport failure** (a running
// server has no unreachable-mid-test equivalent). The one live test that needs an empty-Locations
// UI state stubs *only* that unproducible read — the cast always seeds two Locations and the app
// has no delete — while the Admin invite it then sends still hits the real endpoint.
//
// The eight seeded rows (loadFixtureCast, #193), by the two Locations that matter here:
//   Location A: Mia (manager, active), Eli (employee, active), Ash (employee, active),
//               Ivy (employee, invited), Mona (manager, invited)
//   Location B: Ben (employee, active), Dan (employee, deactivated)
//   no Location: Ada (admin, active) — the chain-wide principal
const LOCATION_A = FIXTURE_LOCATION_IDS.a
const LOCATION_B = FIXTURE_LOCATION_IDS.b

// A mutating test's own invite email, keyed to the test (its tag), the worker, and the attempt,
// so two parallel workers and any retry each address a distinct row — never a shared one. The
// `.test` TLD matches the fixture cast's own addresses and passes the API's email validation.
function uniqueEmail(testInfo: TestInfo, tag: string): string {
  return `${tag}-w${testInfo.workerIndex}-r${testInfo.retry}@e2e.test`
}

// The one roster row carrying an email, resolved as the nearest card ancestor of the row's exact
// email line — not by card class alone, since the list's surrounding Card shares those classes
// (rounded-lg border) and would also match. `exact` keeps the match off the invite-sent alert
// ("Invite sent to <email>."), which merely contains the address. Each mutating test's email is
// unique, so this resolves to exactly that test's row (or none, once it is revoked) — the scope
// the row-action assertions need when the fixture cast's own invited rows (Ivy, Mona) share the list.
function inviteRow(page: Page, email: string): Locator {
  return page
    .getByText(email, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
}

// Observe the invite POST without intercepting it, so the body the UI sends is asserted while the
// request still lands on the real endpoint. Scoped to the create call, not /invites/:id/resend.
function inviteRequest(page: Page) {
  return page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/invites'),
  )
}

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

    // The Location line: a row shows its Location by its resolved *name* (never the raw uuid the
    // old screen exposed — the headline defect this slice fixes), and the location-less admin
    // reads as "Chain-wide". Scope to the sections so the match is the card's line, not the
    // (visually identical) filter option carrying the same text.
    const sections = page.locator('section')
    await expect(sections.getByText('Location B', { exact: false }).first()).toBeVisible()
    await expect(sections.getByText('Chain-wide', { exact: false }).first()).toBeVisible()
    // The raw uuid never reaches the screen.
    await expect(page.getByText(LOCATION_B)).toHaveCount(0)

    // The whole seeded chain is in view before filtering: users at both Locations and the
    // chain-wide admin herself.
    await expect(page.getByText('Ben Bee')).toBeVisible()
    await expect(page.getByText('Dan Gone')).toBeVisible()
    await expect(page.getByText('Ada Admin')).toBeVisible()

    // Filtering to Location A narrows to that Location: its users stay, every other Location's
    // users (and the chain-wide admin) drop out. The filter is the DS listbox Select (the X5
    // fix) over *named* branches, so it is opened and its option picked by name — scoped to the
    // filter's own listbox, since the admin invite form's Location picker carries the same option
    // names.
    const filterListbox = page.getByRole('listbox', { name: 'Filter by location' })
    await page.getByLabel('Filter by location').click()
    await filterListbox.getByRole('option', { name: 'Location A' }).click()
    await expect(page.getByText('Ivy Invitee')).toBeVisible()
    await expect(page.getByText('Ash Active')).toBeVisible()
    await expect(page.getByText('Ben Bee')).toHaveCount(0)
    await expect(page.getByText('Dan Gone')).toHaveCount(0)
    await expect(page.getByText('Ada Admin')).toHaveCount(0)
    // Location B's only deactivated user (Dan) is filtered out, so that section reads as empty.
    await expect(page.getByText('No deactivated people.')).toBeVisible()

    // Clearing the filter (the "All locations" option) restores the chain-wide view.
    await page.getByLabel('Filter by location').click()
    await filterListbox.getByRole('option', { name: 'All locations' }).click()
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

// ---------------------------------------------------------------------------
// Mutation paths (#196): the real invite / 409 / revoke / resend / action-scope, driven through
// the browser against the real endpoints. The request body the UI sends and the list it reads
// back are validated by the real API, not a stub of it.

test.describe('a manager sends a real fixed-remit invite', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('the baked remit (Employee, own Location) is what the real endpoint receives', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'mgr-invite')
    await page.goto('/people')

    await expect(page.getByRole('heading', { name: 'Invite someone' })).toBeVisible()

    // The manager's remit is a stated constraint, not a choice: the fixed-role line shows, and
    // neither a role nor a Location control is offered (a choice the API would reject).
    await expect(
      page.getByText('New people you invite join as Employees at your Location.'),
    ).toBeVisible()
    await expect(page.getByLabel('Role')).toHaveCount(0)
    await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)

    const request = inviteRequest(page)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Mgr Invitee')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    // The body the real endpoint receives is fixed from the principal, never from a form input:
    // the manager's own Location (A) and the employee role, regardless of what the UI omitted.
    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Mgr Invitee',
      role: 'employee',
      locationId: LOCATION_A,
    })
    // The real 201 drives the confirmation naming the recipient.
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })
})

test.describe('an admin sends real invites choosing role and Location', () => {
  test.use({ storageState: STORAGE_STATE.admin })

  test('picking a branch by name invites an employee into that Location', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-invite')
    await page.goto('/people')

    // The admin gets the full choice: a role select, and a Location picker fed by the real GET
    // /locations, showing the fixture cast's branch names rather than a paste-a-UUID field.
    await expect(page.getByLabel('Role')).toBeVisible()
    const locationPicker = page.getByLabel('Location', { exact: true })
    await expect(locationPicker).toBeVisible()
    await expect(locationPicker.getByRole('option', { name: 'Location A' })).toHaveCount(1)
    await expect(locationPicker.getByRole('option', { name: 'Location B' })).toHaveCount(1)

    // Picking a branch by name sends that Location's id, not a typed uuid.
    await locationPicker.selectOption(LOCATION_B)
    const request = inviteRequest(page)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Adm Invitee')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Adm Invitee',
      role: 'employee',
      locationId: LOCATION_B,
    })
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })

  test('choosing the admin role drops the picker and sends a Location-less admin', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-adminvite')
    await page.goto('/people')

    // Choosing the admin role drops the Location picker — an admin invitee is Location-less.
    await expect(page.getByLabel('Location', { exact: true })).toBeVisible()
    await page.getByLabel('Role').selectOption('admin')
    await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)

    const request = inviteRequest(page)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Adm Owner')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    // An admin invitee carries a null Location, sent to and accepted by the real endpoint.
    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Adm Owner',
      role: 'admin',
      locationId: null,
    })
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })

  test('with no Locations, the admin is prompted to create one but can still invite an Admin', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-empty')

    // The live backbone always seeds two Locations and the app has no delete, so the
    // empty-Locations UI state is one the real backend cannot produce. Stub *only* that read to
    // an empty list; the Admin invite this test then sends still hits the real POST /invites.
    await page.route('**/locations', (route) => route.fulfill({ json: { locations: [] } }))
    await page.goto('/people')

    // Decision 7 — the empty-state: a located role has no branch to pick, so the picker is
    // replaced by a prompt to create one first (linking to /locations), and Send is blocked.
    await expect(page.getByLabel('Location', { exact: true })).toHaveCount(0)
    await expect(page.getByText('No locations yet.', { exact: false })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create a location' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send invite', exact: true })).toBeDisabled()

    // Inviting another Admin needs no Location, so the screen is never fully blocked — and the
    // invite still lands on the real endpoint.
    const request = inviteRequest(page)
    await page.getByLabel('Role').selectOption('admin')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Adm Empty')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Adm Empty',
      role: 'admin',
      locationId: null,
    })
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })
})

test.describe('a duplicate invite is refused by the real endpoint', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('inviting an email already in the cast yields a real 409 with its specific message', async ({
    page,
  }) => {
    await page.goto('/people')

    // Ash is a seeded active employee at the manager's own Location (A), so inviting that address
    // is a genuine conflict the real endpoint answers with a 409 — no row is created, so this
    // test needs no unique key and leaves the baseline untouched on every run and retry.
    await page.getByLabel('Email').fill('ash@bb.test')
    await page.getByLabel('Display name').fill('Ash Again')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()

    // The 409 maps to its own specific message, not a generic error.
    await expect(
      page.getByText('That email already has an account or a pending invite.'),
    ).toBeVisible()
  })
})

test.describe('a manager revokes and resends against the real API', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('revoking reads the withdrawn row back gone; a sibling invite stays', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'mgr-revoke')
    await page.goto('/people')

    // Create this test's own invite through the real endpoint; the success refresh reads it back
    // into the list as a pending employee at the manager's Location.
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Revoke Me')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
    await expect(inviteRow(page, email)).toBeVisible()

    // Revoke it through the row's overflow menu, then let the list re-read from the real API: the
    // row is gone because the refreshed /users no longer returns it — not hidden client-side.
    await inviteRow(page, email)
      .getByRole('button', { name: /^Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
    await expect(inviteRow(page, email)).toHaveCount(0)

    // The fixture cast's own pending employee invite (Ivy) is untouched — only this row left.
    await expect(page.getByText('Ivy Invitee')).toBeVisible()
  })

  test('resending re-reads the list with the invite still pending', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo, 'mgr-resend')
    await page.goto('/people')

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Display name').fill('Resend Me')
    await page.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
    await expect(inviteRow(page, email)).toBeVisible()

    // A successful resend re-reads the list from the API (unlike revoke it leaves the row in
    // place — the invite is re-mailed, not withdrawn), so catch the refetch it triggers.
    const refetch = page.waitForResponse(
      (response) => response.request().method() === 'GET' && response.url().endsWith('/users'),
    )
    await inviteRow(page, email)
      .getByRole('button', { name: /^Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Resend invite' }).click()
    await refetch

    // The invite is still pending afterward, and nothing failed.
    await expect(inviteRow(page, email)).toBeVisible()
    await expect(
      page.getByText('That action could not be completed. Refresh and try again.'),
    ).toHaveCount(0)
  })
})

test.describe('a manager sees invite actions only within their action scope', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('resend/revoke on the employee invite (Ivy), none on the manager invite (Mona)', async ({
    page,
  }) => {
    // A manager's list is every user at their Location (list scope), so it includes a still-
    // pending manager invite an admin created there (Mona) — but the manager may act only on an
    // employee invite (invite-action scope). The row actions mirror the real API's scope: the
    // employee invite carries them, the manager invite does not, so the manager never meets a 404.
    await page.goto('/people')

    // Both pending fixture users are in view.
    await expect(page.getByText('Ivy Invitee')).toBeVisible()
    await expect(page.getByText('Mona Manager')).toBeVisible()

    // Exactly the employee invite carries an overflow menu with the actions; the manager invite
    // carries no menu at all (nothing a manager may act on), so the actions are withheld — the
    // manager never meets a control the API would answer with a 404.
    const ivyRow = inviteRow(page, 'ivy@bb.test')
    const monaRow = inviteRow(page, 'mona@bb.test')

    await ivyRow.getByRole('button', { name: /^Actions for/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Resend invite' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Revoke invite' })).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(monaRow.getByRole('button', { name: /^Actions for/ })).toHaveCount(0)
  })
})
