import { defineConfig, devices } from '@playwright/test'

// The E2E lane drives the built SPA, not the dev server: the webServer command runs
// `vite build` then `vite preview`, so the test exercises the same static bundle CI
// ships. Locally an already-running preview is reused; in CI a fresh one is booted.
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A stray test.only must fail the CI run rather than silently narrow the suite.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Keep a trace and a screenshot only when a test fails, so a red run leaves a
    // debuggable artifact without paying to record every green run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // The build runs inside this command, so allow it room on a cold CI runner.
    timeout: 120_000,
  },
})
