import { fileURLToPath } from 'node:url'

// Load the single gitignored root .env (ADR-0010) into process.env. Called by this app's one
// process entrypoint, main.ts, as its first line — before any env value is read — whether the
// container is running the daily schedule or an operator is running a manual --once pass
// (ADR-0026).
//
// This is a function, not a top-level side effect, so importing a module does not load env: the
// job's ports are driven by injected fakes and plain config objects in tests, never through the
// environment.
//
// The path walks the same three levels as the API's copy — src -> apps/whatsapp-digest -> apps ->
// repo root — because this workspace sits at the same depth. In prod there is no .env file at all:
// the container's environment is delivered by compose's env_file, so a missing file is expected.
const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))

export function loadRootEnv(): void {
  try {
    process.loadEnvFile(rootEnvPath)
  } catch {
    // No .env file (e.g. prod, where the environment is provided directly). Fine.
  }
}
