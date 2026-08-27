import { type Locator, type Page, type TestInfo, expect, test } from '@playwright/test'
import { FIXTURE_LOCATION_IDS } from '../../api/test/helpers/fixture-cast.js'
import { STORAGE_STATE } from './env.js'

// The /people surface against the live backbone (#151), recut to The Counter (round 8): the
// roster is one flat table — Person / Role / Branch / Open tasks / row menu — with the
// branch and role filters plus the gold Invite person in the toolbar, and inviting opens a
// Dialog over the roster. These open with a *real* persona session (the bearer the setup
// minted, attached per-role below) and drive the *real* invite endpoints the API scopes
// from that principal (ADR-0007).
//
// The **read** paths read the read-only fixture cast, so they are inherently parallel- and
// retry-safe. The **mutation** paths each create their *own* uniquely-keyed invite
// (`uniqueEmail`) and assert on that one row, never on the shared baseline.
//
// The eight seeded rows (loadFixtureCast, #193), by the two Locations that matter here:
//   Location A: Mia (manager, active), Eli (employee, active), Ash (employee, active),
//               Ivy (employee, invited), Mona (manager, invited)
//   Location B: Ben (employee, active), Dan (employee, deactivated)
//   no Location: Ada (super_admin, active) — the chain-wide principal (2026-08-23: admin
//                narrowed to a branch, so the one Location-less fixture row is a super_admin)
const LOCATION_A = FIXTURE_LOCATION_IDS.a
const LOCATION_B = FIXTURE_LOCATION_IDS.b

function uniqueEmail(testInfo: TestInfo, tag: string): string {
  return `${tag}-w${testInfo.workerIndex}-r${testInfo.retry}@e2e.test`
}

// One roster row, addressed as the table row carrying the text — the desktop table is the
// visible surface at the default viewport (the phone card list is display:none).
function row(page: Page, text: string): Locator {
  return page.getByRole('row').filter({ hasText: text })
}

// Inviting opens the Dialog from the toolbar's Invite person.
async function openInviteDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Invite person' }).click()
  const dialog = page.getByRole('dialog', { name: 'Invite a person' })
  await expect(dialog).toBeVisible()
  return dialog
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

  test('own-Location table, no branch filter, statuses as row notes', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

    // The table renders each seeded Location-A user as one row; a pending invite says so on
    // the person line rather than in a section of its own.
    await expect(row(page, 'Ivy Invitee').getByText(/ivy@bb\.test · Invited/)).toBeVisible()
    await expect(row(page, 'Ash Active').getByText('ash@bb.test', { exact: true })).toBeVisible()

    // Cross-Location rows never reach a manager: Ben (Location B) and Ada (chain-wide) are
    // outside the API's own-Location scope, so they are simply absent from the roster.
    await expect(row(page, 'Ben Bee')).toHaveCount(0)
    await expect(row(page, 'Ada Admin')).toHaveCount(0)

    // No branch filter for a single-Location remit (the role filter is the manager's one
    // narrowing control), and the raw uuid never reaches the screen.
    await expect(page.getByLabel('Filter by location')).toHaveCount(0)
    await expect(page.getByLabel('Filter by role')).toBeVisible()
    await expect(page.getByText(LOCATION_A)).toHaveCount(0)
  })
})

test.describe('the chain owner reads the chain-wide roster', () => {
  test.use({ storageState: STORAGE_STATE.super_admin })

  test('chain-wide table, Branch column, working filter incl. clear-to-all', async ({ page }) => {
    await page.goto('/people')

    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

    // The Branch column: a row shows its Location by its resolved *name* (never the raw
    // uuid), and the location-less admin reads as "Chain-wide".
    await expect(row(page, 'Ben Bee').getByText('Location B')).toBeVisible()
    await expect(row(page, 'Ada Admin').getByText('Chain-wide')).toBeVisible()
    await expect(page.getByText(LOCATION_B)).toHaveCount(0)

    // The whole seeded chain is in view before filtering, the deactivated row included.
    await expect(row(page, 'Dan Gone').getByText(/· Deactivated/)).toBeVisible()

    // Filtering to Location A narrows to that Location: its users stay, every other
    // Location's users (and the chain-wide admin) drop out. The filter is the DS listbox
    // Select over *named* branches.
    const filterListbox = page.getByRole('listbox', { name: 'Filter by location' })
    await page.getByLabel('Filter by location').click()
    await filterListbox.getByRole('option', { name: 'Location A' }).click()
    await expect(row(page, 'Ivy Invitee')).toBeVisible()
    await expect(row(page, 'Ash Active')).toBeVisible()
    await expect(row(page, 'Ben Bee')).toHaveCount(0)
    await expect(row(page, 'Dan Gone')).toHaveCount(0)
    await expect(row(page, 'Ada Admin')).toHaveCount(0)

    // Clearing the filter (the "All branches" option) restores the chain-wide view.
    await page.getByLabel('Filter by location').click()
    await filterListbox.getByRole('option', { name: 'All branches' }).click()
    await expect(row(page, 'Ben Bee')).toBeVisible()
    await expect(row(page, 'Dan Gone')).toBeVisible()
  })

  test('the role filter narrows the table to one role and back', async ({ page }) => {
    await page.goto('/people')

    const roleListbox = page.getByRole('listbox', { name: 'Filter by role' })
    await page.getByLabel('Filter by role').click()
    // exact, because the HQ expansion put eight other "... Manager" titles in this listbox
    // and the default substring match resolves to all of them.
    await roleListbox.getByRole('option', { name: 'Manager', exact: true }).click()

    // Only the seeded managers remain (Mia active, Mona invited); employees and the admin
    // drop out.
    await expect(row(page, 'Mia Manager')).toBeVisible()
    await expect(row(page, 'Ash Active')).toHaveCount(0)
    await expect(row(page, 'Ada Admin')).toHaveCount(0)

    await page.getByLabel('Filter by role').click()
    await roleListbox.getByRole('option', { name: 'All roles' }).click()
    await expect(row(page, 'Ash Active')).toBeVisible()
  })
})

test.describe('an employee is bounced off /people', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('a direct link to /people lands on the dashboard, no provisioning surface', async ({
    page,
  }) => {
    await page.goto('/people')

    // Presentation gating bounces the employee to the first page their role holds — the board
    // again since 2026-08-25, when the dashboard became a branch-runner's screen. The people
    // screen — its heading and its invite affordance — never renders. The API is the real
    // boundary (ADR-0007); here we assert the surface is simply absent on a real session.
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Invite person' })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Mutation paths (#196): the real invite / 409 / revoke / resend / action-scope, driven
// through the browser against the real endpoints via the invite Dialog.

test.describe('a manager sends a real fixed-remit invite', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('the baked remit (Employee, own Location) is what the real endpoint receives', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'mgr-invite')
    await page.goto('/people')

    const dialog = await openInviteDialog(page)

    // The manager's remit is a stated constraint, not a choice: the fixed-role line shows,
    // and neither a role nor a Location control is offered (a choice the API would reject).
    await expect(
      dialog.getByText('New people you invite join as Employees at your Location.'),
    ).toBeVisible()
    await expect(dialog.getByLabel('Role')).toHaveCount(0)
    await expect(dialog.getByLabel('Location', { exact: true })).toHaveCount(0)

    const request = inviteRequest(page)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Display name').fill('Mgr Invitee')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    // The body the real endpoint receives is fixed from the principal, never a form input.
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

test.describe('the chain owner sends real invites choosing role and Location', () => {
  test.use({ storageState: STORAGE_STATE.super_admin })

  test('picking a branch by name invites an employee into that Location', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-invite')
    await page.goto('/people')

    const dialog = await openInviteDialog(page)

    // The admin gets the full choice: a role select, and a Location picker fed by the real
    // GET /locations, showing the fixture cast's branch names rather than a paste-a-UUID field.
    await expect(dialog.getByLabel('Role')).toBeVisible()
    const locationPicker = dialog.getByLabel('Location', { exact: true })
    await expect(locationPicker).toBeVisible()
    await expect(locationPicker.getByRole('option', { name: 'Location A' })).toHaveCount(1)
    await expect(locationPicker.getByRole('option', { name: 'Location B' })).toHaveCount(1)

    // Picking a branch by name sends that Location's id, not a typed uuid.
    await locationPicker.selectOption(LOCATION_B)
    const request = inviteRequest(page)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Display name').fill('Adm Invitee')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Adm Invitee',
      role: 'employee',
      locationId: LOCATION_B,
    })
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })

  // 2026-08-23: admin narrowed to a branch, so an admin invitee now needs a Location like any
  // other located role — only a super_admin, the chain's one Location-less role, drops the
  // picker. Ada (the storageState this describe block signs in as) is herself a super_admin,
  // so appointing another one is exactly what the real endpoint accepts from her.
  test('choosing the super_admin role drops the picker and sends a Location-less super_admin', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-superadminvite')
    await page.goto('/people')

    const dialog = await openInviteDialog(page)

    // Choosing the super_admin role drops the Location picker — a super_admin invitee is
    // Location-less — and the hint under the fields says exactly that.
    await expect(dialog.getByLabel('Location', { exact: true })).toBeVisible()
    await dialog.getByLabel('Role').selectOption('super_admin')
    await expect(dialog.getByLabel('Location', { exact: true })).toHaveCount(0)

    const request = inviteRequest(page)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Display name').fill('Super Owner')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    // A super_admin invitee carries a null Location, sent to and accepted by the real endpoint.
    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Super Owner',
      role: 'super_admin',
      locationId: null,
    })
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
  })

  test('with no Locations, the owner is prompted to create one but can still invite a super_admin', async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'adm-empty')

    // The live backbone always seeds two Locations and the app has no delete, so the
    // empty-Locations UI state is one the real backend cannot produce. Stub *only* that read to
    // an empty list; the invite this test then sends still hits the real POST /invites.
    await page.route('**/locations', (route) => route.fulfill({ json: { locations: [] } }))
    await page.goto('/people')

    const dialog = await openInviteDialog(page)

    // Decision 7 — the empty-state: a located role has no branch to pick, so the picker is
    // replaced by a prompt to create one first (linking to /locations), and Send is blocked.
    await expect(dialog.getByLabel('Location', { exact: true })).toHaveCount(0)
    await expect(dialog.getByText('No locations yet.', { exact: false })).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'Create a location' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Send invite', exact: true })).toBeDisabled()

    // Inviting another super_admin needs no Location (admin now does, since it is narrowed to
    // a branch), so the screen is never fully blocked — and the invite still lands on the real
    // endpoint.
    const request = inviteRequest(page)
    await dialog.getByLabel('Role').selectOption('super_admin')
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Display name').fill('Super Empty')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    expect((await request).postDataJSON()).toEqual({
      email,
      displayName: 'Super Empty',
      role: 'super_admin',
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

    const dialog = await openInviteDialog(page)

    // Ash is a seeded active employee at the manager's own Location (A), so inviting that
    // address is a genuine conflict the real endpoint answers with a 409 — no row is created,
    // so this test needs no unique key and leaves the baseline untouched on every run.
    await dialog.getByLabel('Email').fill('ash@bb.test')
    await dialog.getByLabel('Display name').fill('Ash Again')
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()

    // The 409 maps to its own specific message, not a generic error.
    await expect(
      page.getByText('That email already has an account or a pending invite.'),
    ).toBeVisible()
  })
})

test.describe('a manager revokes and resends against the real API', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  // Send this test's own invite through the Dialog, then close it so the roster is back in
  // front for the row-menu action.
  async function sendInvite(page: Page, email: string, name: string) {
    const dialog = await openInviteDialog(page)
    await dialog.getByLabel('Email').fill(email)
    await dialog.getByLabel('Display name').fill(name)
    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click()
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible()
    await page.keyboard.press('Escape')
  }

  // Hiring is one act on one switch (owner call 2026-08-26, folding the paperwork back into
  // people.invite): whoever may send an invite may chase the one they sent. Proven against the
  // real endpoint, since the row menu and the API agreeing is the whole point of the change.
  test('the invite a manager sent can be resent, and then revoked', async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo, 'mgr-invite')
    await page.goto('/people')

    await sendInvite(page, email, 'Chase Me')
    await expect(row(page, email)).toBeVisible()

    await row(page, email)
      .getByRole('button', { name: /^Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Resend invite' }).click()
    await expect(row(page, email)).toBeVisible()

    // Revoke removes the pending user outright, which is the read-back proof the call landed
    // on the real API rather than being swallowed by the menu.
    await row(page, email)
      .getByRole('button', { name: /^Actions for/ })
      .click()
    await page.getByRole('menuitem', { name: 'Revoke invite' }).click()
    await expect(row(page, email)).toHaveCount(0)

    await page.reload()
    await expect(row(page, email)).toHaveCount(0)
  })
})

test.describe('a manager chases invites but cannot touch an account', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('a pending invite carries the chase, an active account carries nothing', async ({
    page,
  }) => {
    // A manager's list is every user at their Location (list scope), so it holds pending
    // invites AND active accounts. Chasing an invite is people.invite, which they hold since
    // 2026-08-26; deactivating is people.deactivate, which they never held. So the split runs
    // along the row's STATUS, and the manager still never meets a control the API would refuse.
    await page.goto('/people')

    await expect(row(page, 'Ivy Invitee')).toBeVisible()
    await expect(row(page, 'Mona Manager')).toBeVisible()

    for (const name of ['Ivy Invitee', 'Mona Manager']) {
      await row(page, name)
        .getByRole('button', { name: `Actions for ${name}` })
        .click()
      await expect(page.getByRole('menuitem', { name: 'Resend invite' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Revoke invite' })).toBeVisible()
      // Never the one they do not hold.
      await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
  })
})
