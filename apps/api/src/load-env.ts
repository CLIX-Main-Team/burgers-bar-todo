import { fileURLToPath } from 'node:url'

// Load the single gitignored root .env (ADR-0010) into process.env. Called by the
// API's process entrypoints — the dev/start server and the migrate/seed scripts,
// which npm runs with cwd at apps/api — before any env value is read.
//
// This is a function, not a top-level side effect, so importing a module like
// runMigrations does not load env: the integration-test harness reuses that code
// and passes its connection string in directly, never through the environment.
//
// In prod (Render) there is no .env file; the real environment is already set, so
// a missing file is expected and ignored.
const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))

export function loadRootEnv(): void {
  try {
    process.loadEnvFile(rootEnvPath)
  } catch {
    // No .env file (e.g. prod, where the environment is provided directly). Fine.
  }
}
