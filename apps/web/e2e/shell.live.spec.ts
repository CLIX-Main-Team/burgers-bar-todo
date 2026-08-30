import { expect, test } from '@playwright/test'
import { STORAGE_STATE } from './env.js'

// The navigation rail at its phone measure (below `md`) on the live backbone (#151, converting
// #197). Where the stubbed shell.spec.ts seeded a bearer and fulfilled /auth/me at the network
// edge, these open with a *real* persona session — the bearer the setup minted, attached per
// role at the describe level (`test.use`, the people.live pattern) — so the shell's navigation
// runs behind the real API's own /auth/me read.
//
// The whole file pins a phone viewport. Since the v2 handoff (§7) there is one shell at every
// width: the same rail, 74px of icons over labels here and 240px of labelled rows from `md`
// (covered stubbed in shell.spec's desktop block). The phone header and bottom tab bar are
// gone, and the rail's own foot carries the account panel as a bottom sheet.
//
// Nothing here mutates the session, so the shared persona sessions are safe to reuse: Eli
// (employee, three rows since the Dashboard landed in round 10), Mia (manager, a Knowledge
// row on top), and Ada (admin, Locations too) — the phone rail drops the rail-only
// destinations (Projects), and the account panel carries the Users row at both measures.
// The phone bar's last cell is More, not Account: it opens one sheet carrying the overflow
// destinations, the management rows AND the settings, so "Account" would name a third of what
// is behind it. Its accessible name matches the word printed under the glyph, which is the rule
// (WCAG 2.5.3). The desktop rail's foot is still Account and shell.spec.ts still opens it by
// that name — the two triggers are never on screen at the same width.
test.use({ viewport: { width: 390, height: 720 } })

test.describe('the phone shell for an employee session', () => {
  test.use({ storageState: STORAGE_STATE.employee })

  test('visiting / redirects to /tasks and shows the Tasks row active', async ({ page }) => {
    await page.goto('/')
    // The dashboard became a branch-runner's screen on 2026-08-25, so an employee's first
    // destination is their board.
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('the rail shows exactly three destinations for an employee', async ({ page }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Projects joined the employee rail on 2026-08-23, when a project gained its own roles
    // field: an employee sees the projects that name their role, so the destination is theirs
    // too. What they see inside it is the API's scope predicate, not this count. The Dashboard
    // left again on 2026-08-25, being a report on a branch for whoever runs it.
    await expect(nav.getByRole('link')).toHaveCount(3)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Assistant' })).toBeVisible()
  })

  test('each rail destination shows its icon, and the active one renders filled', async ({
    page,
  }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    const tasksLink = nav.getByRole('link', { name: 'Tasks' })
    const assistantLink = nav.getByRole('link', { name: 'Assistant' })

    // Each destination draws exactly one glyph — the decorative <Icon> svg. The gold marker
    // bar is a <span>, so a single svg per link confirms the icon rendered (iconography.md).
    await expect(tasksLink.locator('svg')).toHaveCount(1)
    await expect(assistantLink.locator('svg')).toHaveCount(1)

    // The active destination renders at the reserved `fill` weight, inactive at `regular` —
    // Phosphor draws a different path geometry per weight, so the Tasks glyph's path differs
    // between active (on /tasks) and inactive (on /assistant). That difference is the second,
    // non-colour active signal the weight axis was chosen for.
    const tasksPath = tasksLink.locator('svg path').first()
    const filledWhenActive = await tasksPath.getAttribute('d')
    expect(filledWhenActive).toBeTruthy()

    await assistantLink.click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(tasksLink).not.toHaveAttribute('aria-current', 'page')
    const regularWhenInactive = await tasksPath.getAttribute('d')

    expect(filledWhenActive).not.toBe(regularWhenInactive)
  })

  test('tapping Assistant then Tasks moves between the two and tracks the active tab', async ({
    page,
  }) => {
    await page.goto('/tasks')

    await page.getByRole('link', { name: 'Assistant' }).click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(page.getByRole('link', { name: 'Tasks' })).not.toHaveAttribute(
      'aria-current',
      'page',
    )

    await page.getByRole('link', { name: 'Tasks' }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page')
  })

  test('the active tab tracks the URL on a deep link and on browser back', async ({ page }) => {
    // Deep link straight to Assistant: the bar reflects the URL, not any tap history.
    await page.goto('/assistant')
    await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // Navigate to Tasks, then browser-back should return to Assistant with its tab active.
    await page.getByRole('link', { name: 'Tasks' }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(page.getByRole('link', { name: 'Assistant' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('toggling Hebrew flips the document direction and language, and English flips back', async ({
    page,
  }) => {
    await page.goto('/tasks')

    const html = page.locator('html')
    await expect(html).toHaveAttribute('dir', 'ltr')
    await expect(html).toHaveAttribute('lang', 'en')

    // The language toggle now lives inside the account menu; open it first.
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'עברית' }).click()
    await expect(html).toHaveAttribute('dir', 'rtl')
    await expect(html).toHaveAttribute('lang', 'he')

    await page.getByRole('button', { name: 'English' }).click()
    await expect(html).toHaveAttribute('dir', 'ltr')
    await expect(html).toHaveAttribute('lang', 'en')
  })
})

test.describe('the phone shell for a manager session', () => {
  test.use({ storageState: STORAGE_STATE.manager })

  test('a manager gets the Knowledge row on the rail; Users sits in the account panel', async ({
    page,
  }) => {
    await page.goto('/tasks')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    // Users left the rail (owner call 2026-08-13, during client testing): a manager sees Tasks,
    // Projects, Assistant, Knowledge (ADR-0024) and, since 2026-08-25, their own branch page —
    // but no Dashboard, and the account panel is still the one door to Users.
    // Since 2026-08-30 the phone carries a bottom bar of FOUR destinations plus More, so those
    // five destinations split: the first four are cells and the branch page is in the panel.
    // Counted before the panel opens — it is a DOM descendant of the bar, so its rows would be
    // counted too.
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Knowledge' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toHaveCount(0)
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    // The destination the bar had no cell for reaches the phone here.
    await expect(page.getByRole('link', { name: 'Locations' })).toBeVisible()
  })

  test('a manager can reach the users surface at /people from the account panel', async ({
    page,
  }) => {
    await page.goto('/tasks')

    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL(/\/people$/)
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
  })
})

test.describe('the phone shell for an admin session', () => {
  test.use({ storageState: STORAGE_STATE.super_admin })

  test('an admin gets the Locations row on the rail; Users sits in the account panel', async ({
    page,
  }) => {
    await page.goto('/tasks')

    // An admin holds six destinations (Dashboard per round 10, Knowledge per ADR-0024, Users
    // moved to the account panel 2026-08-13, and Projects since it stopped being desktop-only on
    // 2026-08-23). Since 2026-08-30 the phone's bar takes the first FOUR of them and More takes
    // the rest, so the two an admin has beyond the budget are in the panel rather than missing.
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Projects' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Locations' })).toHaveCount(0)
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
    // Both overflow destinations reach the phone through the panel.
    await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Locations' })).toBeVisible()
  })
})
