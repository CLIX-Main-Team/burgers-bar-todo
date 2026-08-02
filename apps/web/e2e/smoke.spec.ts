import { expect, test } from '@playwright/test'

// Permanent liveness check, not a scaffold test: it asserts the SPA loads and React
// mounts into #root — before hydration the root is empty, so a non-empty root proves
// the bundle booted. It deliberately avoids asserting any specific copy or component,
// so it keeps passing as the shell grows into real screens.
test('app loads and mounts its React root', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#root')).not.toBeEmpty()
})
