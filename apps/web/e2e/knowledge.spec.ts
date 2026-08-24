import { capabilitiesFor } from '@burgers/shared'
import { type Page, expect, test } from '@playwright/test'

// The Knowledge tab (ADR-0024) as UI wiring over a stubbed API — same harness as people.spec:
// the built bundle under preview, the session stubbed at the network edge. The categorizer and
// the listing endpoint have their own API integration tests; what this proves is the browser —
// the nav row and its gate, the shelf grouping, the Drive link-out — over a canned corpus.

const MANAGER = {
  userId: '11111111-1111-1111-1111-111111111111',
  displayName: 'Yael Bar',
  role: 'manager',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('manager'),
} as const

const EMPLOYEE = {
  userId: '55555555-5555-5555-5555-555555555555',
  displayName: 'Noa Levi',
  role: 'employee',
  locationId: '22222222-2222-2222-2222-222222222222',
  status: 'active',
  capabilities: capabilitiesFor('employee'),
} as const

const CORPUS = {
  lastSyncAt: '2026-08-01T10:00:00.000Z',
  docs: [
    {
      id: 'c1111111-1111-1111-1111-111111111111',
      driveFileId: 'drive-open',
      title: 'Opening checklist',
      category: 'procedures',
      status: 'ingested',
      skipReason: null,
      sourceMimeType: 'application/vnd.google-apps.document',
      driveModifiedTime: '2026-07-01T00:00:00.000Z',
    },
    {
      id: 'c2222222-2222-2222-2222-222222222222',
      driveFileId: 'drive-pay',
      title: 'Payroll checklist',
      category: 'finance',
      status: 'ingested',
      skipReason: null,
      sourceMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      driveModifiedTime: '2026-07-02T00:00:00.000Z',
    },
  ],
}

async function seedPrincipal(page: Page, principal: typeof MANAGER | typeof EMPLOYEE) {
  await page.addInitScript(() => {
    localStorage.setItem('burgers.session.token', 'e2e-stub-token')
  })
  await page.route('**/auth/me', (route) => route.fulfill({ json: principal }))
}

test('a manager browses the corpus: nav row → shelves → a doc linking out to Drive', async ({
  page,
}) => {
  await seedPrincipal(page, MANAGER)
  await page.route('**/assistant/knowledge', (route) => route.fulfill({ json: CORPUS }))
  await page.goto('/knowledge')

  // The header counts the corpus and dates the mirror.
  await expect(page.getByText(/2 documents/)).toBeVisible()

  // The folder grid shows every fixed shelf as a Drive-style tile — stocked ones counted,
  // empty ones say so — under the search field that filters the whole corpus. Tiles are
  // addressed by role: the shelf name also rides each recent row's second line now.
  await expect(page.getByPlaceholder('Search folders and documents')).toBeVisible()
  await expect(page.getByRole('button', { name: /Procedures & checklists/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Menu & kitchen/ })).toContainText('Empty')

  // Inside a shelf, the doc row links to the original in Drive, new tab.
  await page.getByRole('button', { name: /Finance & payroll/ }).click()
  const row = page.getByRole('link', { name: /Payroll checklist/ })
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-pay/view')
  await expect(row).toHaveAttribute('target', '_blank')
})

test('the tab bar carries Knowledge on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedPrincipal(page, MANAGER)
  await page.route('**/assistant/knowledge', (route) => route.fulfill({ json: CORPUS }))
  await page.goto('/knowledge')

  // The mobile tab bar (one nav list, two shells) shows the row for a manager, marked current.
  await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Procedures & checklists/ })).toBeVisible()
})

test('an employee never meets the tab: no nav row, and a direct visit bounces to the board', async ({
  page,
}) => {
  await seedPrincipal(page, EMPLOYEE)
  await page.route('**/tasks/board*', (route) =>
    route.fulfill({ json: { tasks: [], members: [] } }),
  )
  await page.goto('/knowledge')

  // The capability guard bounces to the first page the role holds — the Dashboard, the same
  // place `/` lands (2026-08-24; previously the task board).
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('link', { name: 'Knowledge' })).not.toBeVisible()
})
