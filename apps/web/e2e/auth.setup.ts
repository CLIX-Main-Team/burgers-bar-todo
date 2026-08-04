import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Role } from '@burgers/shared'
import { expect, test as setup } from '@playwright/test'
import { Pool } from 'pg'
import { systemClock } from '../../api/src/auth/clock.js'
import { createCapturingMailer } from '../../api/src/auth/mailer.js'
import { createAuthComponents } from '../../api/src/auth/wire.js'
import { createDb } from '../../api/src/db/client.js'
import { runMigrations } from '../../api/src/db/migrate.js'
import { createLocationRepository } from '../../api/src/locations/repository.js'
import { type FixtureCast, loadFixtureCast } from '../../api/test/helpers/fixture-cast.js'
import {
  API_BASE_URL,
  PREVIEW_ORIGIN,
  SESSION_TOKEN_KEY,
  STORAGE_STATE,
  e2eDatabaseUrl,
} from './env.js'

// The live lane's one setup project (part of #151). Playwright brings both webServers up
// first, then runs this before every live-role and login-form project (they list it in
// `dependencies`). It does the three things that turn a running API into a lane a browser
// can sign into:
//
//   1. reset + migrate the shared Postgres to a known-empty schema, so
//   2. loadFixtureCast (#193) realizes the 8-row cast over the app's own seams, and
//   3. each of the three personas signs in through the *real* POST /auth/sign-in, and its
//      bearer is written to a per-role storageState the live projects attach.
//
// The seeding talks to Postgres directly (its own pool); the sign-in talks to the running
// server over HTTP — so the session a live spec opens with is one the real endpoint minted,
// not a stub. The stubbed specs (smoke, shell, people, tasks*, assistant*, …) do not depend
// on this project and never touch the live backend.

const INVITE_TTL_MS = 168 * 60 * 60 * 1000 // ~1 week, matching the app's INVITE_TTL_HOURS.

setup('seed the fixture cast and save a session per persona', async ({ request }) => {
  // Migrate + seed + three argon2 hashes; generous room on a cold CI runner.
  setup.setTimeout(120_000)

  const databaseUrl = e2eDatabaseUrl()

  // A local run points at a dedicated `burgers_e2e` database that may not exist yet; create
  // it if missing so `docker compose up -d db mailpit` is the only manual step. In CI the DB
  // is declared by the postgres service, so this is a no-op there.
  await ensureDatabase(databaseUrl)

  // Reset to a known-empty schema before migrating: loadFixtureCast assumes a fresh database
  // and throws on a second row, so every run must start clean. Dropping `drizzle` too clears
  // the migration journal, so runMigrations re-applies the whole committed history.
  const reset = createDb(databaseUrl)
  try {
    await reset.pool.query(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    )
  } finally {
    await reset.pool.end()
  }
  await runMigrations(databaseUrl)

  // Realize the cast over the same seams createAuthComponents composes for the running server
  // (the fixture-cast integration test wires it identically). No mailer mail is sent — the
  // capturing mailer only satisfies the constructor. argon2 cost is lowered for speed; the
  // encoded hash still verifies against sign-in's default-cost hasher (argon2 reads the cost
  // from the hash, not the verifier).
  const seed = createDb(databaseUrl)
  let cast: FixtureCast
  try {
    const components = createAuthComponents(seed.db, systemClock, createCapturingMailer(), {
      sessionTtlDays: 14,
      inviteTtlMs: INVITE_TTL_MS,
      resetTtlMs: 60 * 60 * 1000,
      appBaseUrl: PREVIEW_ORIGIN,
      resetRateLimit: { perEmail: 5, perIp: 20, windowMs: 60 * 60 * 1000 },
      argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
    })
    cast = await loadFixtureCast({
      locations: createLocationRepository(seed.db),
      repo: components.repo,
      hasher: components.hasher,
      tokens: components.tokenService,
      clock: systemClock,
      inviteTtlMs: INVITE_TTL_MS,
    })
  } finally {
    await seed.pool.end()
  }

  // Sign each persona in through the real endpoint and persist its bearer as a session for
  // the preview origin. The personas are exactly Ada (admin), Mia (manager), Eli (employee).
  for (const persona of cast.personas) {
    const response = await request.post(`${API_BASE_URL}/auth/sign-in`, {
      data: { email: persona.email, password: persona.password },
    })
    expect(
      response.ok(),
      `real sign-in failed for ${persona.email} (${response.status()})`,
    ).toBeTruthy()
    const { token } = (await response.json()) as { token: string }
    await saveSession(persona.role, token)
  }
})

// Write a Playwright storageState that seeds the bearer into the preview origin's
// localStorage — the same key the SPA reads on boot, so the app comes up already signed in.
async function saveSession(role: Role, token: string): Promise<void> {
  const path = STORAGE_STATE[role]
  const state = {
    cookies: [],
    origins: [
      {
        origin: PREVIEW_ORIGIN,
        localStorage: [{ name: SESSION_TOKEN_KEY, value: token }],
      },
    ],
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2))
}

// Create the target database if it is absent (local convenience). The name comes from our own
// config, never user input, so interpolating it into CREATE DATABASE is safe. Connecting to
// the always-present `postgres` maintenance database to do it.
async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url)
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''))
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const admin = new Pool({ connectionString: adminUrl.toString() })
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`)
    }
  } finally {
    await admin.end()
  }
}
