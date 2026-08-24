import { fileURLToPath } from 'node:url'

// One source of truth for the live e2e lane's wiring, imported by playwright.config.ts (to
// build the webServer array and the projects), by auth.setup.ts (to reset+seed the DB and
// sign the personas in), and by the live specs. Keeping ports, origins, the database URL,
// and the storageState paths here means the config and the setup can never disagree about
// where the API is, where the built SPA is served, or which file each role's session lands in.

// The real API (server.ts) listens here; the built SPA is served from the preview origin.
// Two localhost ports so the built bundle's baked-in VITE_API_BASE_URL, the API's
// CORS_ORIGIN, and the setup's sign-in target all line up (part of the full-stack e2e lane,
// #151). The defaults are CI's; the env overrides exist for a dev machine where 3000 or
// 4173 is already taken (another local stack, or a Windows reserved-port range) — every
// consumer reads these constants, so an override stays consistent across the whole lane.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3000)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173)
export const API_BASE_URL = `http://localhost:${API_PORT}`
export const PREVIEW_ORIGIN = `http://localhost:${WEB_PORT}`

// The one Postgres the API webServer and the setup step share (the spec's deliberate
// config-time DATABASE_URL). A dedicated `burgers_e2e` database by default so a local run
// never touches the `burgers` dev DB the docker-compose `db` service also hosts; CI overrides
// it via E2E_DATABASE_URL to point at its `postgres:17` service. It is read here, not from a
// root .env, so the value is identical for the API process and the seeder.
export function e2eDatabaseUrl(): string {
  return process.env.E2E_DATABASE_URL ?? 'postgres://burgers:burgers@localhost:5432/burgers_e2e'
}

// Per-role session files the setup writes and the live role projects attach. The three
// personas (Ada super_admin, Mia manager, Eli employee) each get one, holding the real bearer
// the live API minted, so a live spec opens already signed in. Gitignored (regenerated every
// run).
//
// Keyed by the persona's role, and the setup indexes it with that role, so a cast whose role
// is missing here writes no session at all. Ada was an `admin` until 2026-08-23, when admin
// narrowed to a single branch and the chain-wide row became a super_admin. The key moved with
// her rather than keeping a name the model no longer has.
const authDir = fileURLToPath(new URL('./.auth/', import.meta.url))
export const STORAGE_STATE = {
  super_admin: `${authDir}super-admin.json`,
  manager: `${authDir}manager.json`,
  employee: `${authDir}employee.json`,
} as const

// The localStorage key the SPA reads the bearer from (owned by lib/token-storage.ts). A
// storageState that sets it is a signed-in session; the setup writes it per persona, and a
// live spec that mints its own throwaway session seeds it directly. One declaration here so
// those sites can't drift from the key the app actually reads.
export const SESSION_TOKEN_KEY = 'burgers.session.token'
