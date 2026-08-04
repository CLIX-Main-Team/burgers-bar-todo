import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import {
  API_BASE_URL,
  API_PORT,
  PREVIEW_ORIGIN,
  STORAGE_STATE,
  WEB_PORT,
  e2eDatabaseUrl,
} from './e2e/env.js'

// The E2E lane has a live backbone (#151): the browser drives the built SPA under `vite
// preview`, and behind it runs the *real* API on Postgres — not a set of route stubs. Two
// webServers come up first (the API, then the built preview pointed at it), a setup project
// seeds the DB and signs the personas in, and the live projects open with those real sessions.
//
// The pre-existing specs still stub the network at the browser edge, so they keep passing
// untouched — they live in the `chromium` project, which depends on neither the DB nor the
// setup. Only the `*.live.spec.ts` specs use the live backbone.
const apiDir = fileURLToPath(new URL('../api', import.meta.url))
const chrome = devices['Desktop Chrome']

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A stray test.only must fail the CI run rather than silently narrow the suite.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PREVIEW_ORIGIN,
    // Keep a trace and a screenshot only when a test fails, so a red run leaves a
    // debuggable artifact without paying to record every green run.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Seeds the shared Postgres and writes a per-role session; a dependency of every live
    // project. Its own testMatch is needed because `auth.setup.ts` is not a `*.spec` file.
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },

    // The stubbed suite (smoke, people, tasks*, assistant*, manifest, theme-toggle,
    // pre-auth-frame, the shell's desktop block, and the one account-menu logout-all case a
    // shared backbone can't host). It intercepts the API at the browser edge, so it needs no
    // live backend and no setup — it is excluded from the live specs by testIgnore.
    {
      name: 'chromium',
      testIgnore: /\.live\.spec\.ts$/,
      use: { ...chrome },
    },

    // Live, role-scoped: session.live.spec runs once per persona, each project attaching the
    // real session the setup minted for that role. This is where "downstream projects depend
    // on setup and attach the matching state" lives.
    {
      name: 'live-admin',
      testMatch: /session\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome, storageState: STORAGE_STATE.admin },
    },
    {
      name: 'live-manager',
      testMatch: /session\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome, storageState: STORAGE_STATE.manager },
    },
    {
      name: 'live-employee',
      testMatch: /session\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome, storageState: STORAGE_STATE.employee },
    },

    // Live, role-scoped in-file: the /people read paths (#195). One project, because each
    // test attaches its own persona session at the describe level (test.use storageState) —
    // the manager, admin, and employee each read the real scoped roster in the same file.
    {
      name: 'live-people',
      testMatch: /people\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome },
    },

    // Live, role-scoped in-file: the mobile account menu (#197). Like live-people, one project
    // whose tests attach their persona session per describe (test.use storageState) — the menu
    // is role-branched. The spec pins a phone viewport (the desktop shell has no account-foot
    // Manage entries), so this covers the mobile menu only.
    {
      name: 'live-account-menu',
      testMatch: /account-menu\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome },
    },

    // Live, role-scoped in-file: the phone shell (#197). Employee/manager/admin describes each
    // attach their own persona session (test.use storageState); the spec pins a phone viewport,
    // so this covers the bottom-bar shell — the desktop side nav stays stubbed in shell.spec.
    {
      name: 'live-shell',
      testMatch: /shell\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome },
    },

    // Live, anonymous: the one test that drives the real login form. No storageState — it
    // starts signed out and signs in through the form against the live API.
    {
      name: 'live-login-form',
      testMatch: /login-form\.live\.spec\.ts$/,
      dependencies: ['setup'],
      use: { ...chrome },
    },
  ],
  // Two servers, brought up (and, in CI, torn down) around the run. Playwright waits for both
  // before any project starts.
  webServer: [
    {
      // The real API on :3000, readiness polled on /health. The e2e env satisfies the whole
      // boot: a dummy provider key clears the ADR-0018 fail-fast (the assistant is never
      // exercised here), dummy Drive credentials clear the ADR-0021 boot validation (the
      // knowledge sync is never exercised here — the boot reconcile fails against the fake
      // account and is logged, never fatal), SMTP points at the local mailpit so invite mail
      // sinks, and CORS_ORIGIN admits the preview origin the cross-origin bearer is sent from.
      command: 'npm run start',
      cwd: apiDir,
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_URL: e2eDatabaseUrl(),
        API_PORT: String(API_PORT),
        CORS_ORIGIN: PREVIEW_ORIGIN,
        ASSISTANT_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'e2e-dummy-key-never-called',
        // Base64 of {"client_email":"e2e@example.com","private_key":"e2e-dummy-key-never-called"}
        // — a well-formed placeholder that passes env.ts's structural check without reaching Drive.
        GOOGLE_SERVICE_ACCOUNT_JSON:
          'eyJjbGllbnRfZW1haWwiOiJlMmVAZXhhbXBsZS5jb20iLCJwcml2YXRlX2tleSI6ImUyZS1kdW1teS1rZXktbmV2ZXItY2FsbGVkIn0=',
        DRIVE_FOLDER_ID: 'e2e-dummy-folder-never-read',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
      },
    },
    {
      // The built SPA under preview. The bundle bakes in VITE_API_BASE_URL at build time, so
      // the browser's fetches go to the real API above — the build runs inside this command.
      command: `npm run build && npm run preview -- --port ${WEB_PORT} --strictPort`,
      url: PREVIEW_ORIGIN,
      reuseExistingServer: !process.env.CI,
      // The build runs inside this command, so allow it room on a cold CI runner.
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: API_BASE_URL,
      },
    },
  ],
})
