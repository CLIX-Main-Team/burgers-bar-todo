import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMutableClock } from '../src/auth/clock.js'
import { createCapturingMailer } from '../src/auth/mailer.js'
import type { PasswordHasher } from '../src/auth/password.js'
import type { AuthRepository } from '../src/auth/repository.js'
import { createAuthComponents } from '../src/auth/wire.js'
import { type Db, createDb } from '../src/db/client.js'
import { authTokens } from '../src/db/schema.js'
import { type LocationRepository, createLocationRepository } from '../src/locations/repository.js'
import {
  FIXTURE_LOCATION_IDS,
  FIXTURE_PERSONA_PASSWORDS,
  FIXTURE_USER_IDS,
  type FixtureCast,
  loadFixtureCast,
} from './helpers/fixture-cast.js'
import { type TestDb, startTestDb } from './helpers/test-db.js'

// The one seam beneath the live e2e lane (#193). The lane exercises it implicitly — if the
// cast is wrong, the /people list tests fail — but here we drive loadFixtureCast directly
// against a fresh migrated Postgres and assert the cast's shape and per-role/scope contents.
// Scope reads go through the real listUsers seam (ADR-0007), so the assertions prove what each
// audience would actually see, not raw row counts. The one place we read a row at rest is the
// invite token: its raw value is intentionally discarded, so the auth_tokens row is the only
// witness that the two invited rows are genuine Invites.

const INVITE_TTL_MS = 168 * 60 * 60 * 1000 // ~1 week, matching the app's INVITE_TTL_HOURS.
const CLOCK_START = new Date('2026-01-01T00:00:00.000Z')

describe('loadFixtureCast: the 8-row test-only fixture cast (#193)', () => {
  let testDb: TestDb
  let db: Db
  let close: () => Promise<void>
  let repo: AuthRepository
  let hasher: PasswordHasher
  let locations: LocationRepository
  let cast: FixtureCast
  // The invite-token rows, read once after the cast is built (the raw values are discarded).
  let inviteTokens: { userId: string; usedAt: Date | null; expiresAt: Date }[]

  beforeAll(async () => {
    testDb = await startTestDb()
    const created = createDb(testDb.connectionString)
    db = created.db
    close = () => created.pool.end()

    const clock = createMutableClock(CLOCK_START)
    const components = createAuthComponents(db, clock, createCapturingMailer(), {
      sessionTtlDays: 14,
      inviteTtlMs: INVITE_TTL_MS,
      resetTtlMs: 60 * 60 * 1000,
      appBaseUrl: 'http://localhost:5173',
      resetRateLimit: { perEmail: 3, perIp: 3, windowMs: 60 * 60 * 1000 },
      // argon2id cost lowered for speed — a timing change, not a behaviour change.
      argon2Cost: { memoryCost: 64, timeCost: 1, parallelism: 1 },
    })
    repo = components.repo
    hasher = components.hasher
    locations = createLocationRepository(db)

    cast = await loadFixtureCast({
      locations,
      repo: components.repo,
      hasher: components.hasher,
      tokens: components.tokenService,
      clock,
      inviteTtlMs: INVITE_TTL_MS,
    })

    inviteTokens = await db
      .select({
        userId: authTokens.userId,
        usedAt: authTokens.usedAt,
        expiresAt: authTokens.expiresAt,
      })
      .from(authTokens)
      .where(eq(authTokens.purpose, 'invite'))
  })

  afterAll(async () => {
    await close?.()
    await testDb?.stop()
  })

  it('returns a summary with the pinned ids and the three login personas', () => {
    expect(cast.locationIds).toEqual(FIXTURE_LOCATION_IDS)
    expect(cast.users).toHaveLength(8)
    // Exactly the three personas carry a password; the summary surfaces them.
    expect(cast.personas.map((p) => p.key)).toEqual(['ada', 'mia', 'eli'])
    expect(cast.personas.every((p) => p.password !== undefined)).toBe(true)
  })

  it('an admin scope reads all 8 rows: 3 roles × 3 statuses × 2 Locations + a chain-wide admin', async () => {
    const all = await repo.listUsers({ role: 'admin', locationId: null })
    expect(all).toHaveLength(8)

    expect(countBy(all, (u) => u.role)).toEqual({ admin: 1, manager: 2, employee: 5 })
    expect(countBy(all, (u) => u.status)).toEqual({ active: 5, invited: 2, deactivated: 1 })
    expect(countBy(all, (u) => u.locationId ?? 'chain-wide')).toEqual({
      [FIXTURE_LOCATION_IDS.a]: 5,
      [FIXTURE_LOCATION_IDS.b]: 2,
      'chain-wide': 1,
    })

    // The one chain-wide row is Ada the admin, with no Location.
    const admin = all.find((u) => u.role === 'admin')
    expect(admin?.id).toBe(FIXTURE_USER_IDS.ada)
    expect(admin?.locationId).toBeNull()
  })

  it('a manager scope reads only their own Location (ADR-0007)', async () => {
    const locationA = await repo.listUsers({ role: 'manager', locationId: FIXTURE_LOCATION_IDS.a })
    expect(locationA.map((u) => u.id).sort()).toEqual(
      [
        FIXTURE_USER_IDS.mia,
        FIXTURE_USER_IDS.eli,
        FIXTURE_USER_IDS.ivy,
        FIXTURE_USER_IDS.ash,
        FIXTURE_USER_IDS.mona,
      ].sort(),
    )
    // Neither the other Location nor the chain-wide admin leaks into a scoped read.
    expect(locationA.some((u) => u.id === FIXTURE_USER_IDS.ben)).toBe(false)
    expect(locationA.some((u) => u.id === FIXTURE_USER_IDS.ada)).toBe(false)

    const locationB = await repo.listUsers({ role: 'manager', locationId: FIXTURE_LOCATION_IDS.b })
    expect(locationB.map((u) => u.id).sort()).toEqual(
      [FIXTURE_USER_IDS.ben, FIXTURE_USER_IDS.dan].sort(),
    )
  })

  it('the three personas are active and sign in with their known password', async () => {
    const cases = [
      { email: 'ada@bb.test', id: FIXTURE_USER_IDS.ada, password: FIXTURE_PERSONA_PASSWORDS.ada },
      { email: 'mia@bb.test', id: FIXTURE_USER_IDS.mia, password: FIXTURE_PERSONA_PASSWORDS.mia },
      { email: 'eli@bb.test', id: FIXTURE_USER_IDS.eli, password: FIXTURE_PERSONA_PASSWORDS.eli },
    ]
    for (const persona of cases) {
      const row = await repo.findUserByEmail(persona.email)
      expect(row?.id).toBe(persona.id)
      expect(row?.status).toBe('active')
      expect(row?.passwordHash).not.toBeNull()
      // The stored hash verifies against the known password the same way sign-in does.
      expect(await hasher.verify(row?.passwordHash ?? '', persona.password)).toBe(true)
    }
  })

  it('the active-but-no-login rows never open with a persona password', async () => {
    // Ash is active, so it carries a credential — but one no test knows, so no persona
    // password ever verifies against it.
    const ash = await repo.findUserByEmail('ash@bb.test')
    expect(ash?.status).toBe('active')
    expect(ash?.passwordHash).not.toBeNull()
    for (const password of Object.values(FIXTURE_PERSONA_PASSWORDS)) {
      expect(await hasher.verify(ash?.passwordHash ?? '', password)).toBe(false)
    }
  })

  it('the two invited rows are genuine Invites: a pending user + one live invite token, no password', async () => {
    for (const email of ['ivy@bb.test', 'mona@bb.test']) {
      const row = await repo.findUserByEmail(email)
      expect(row?.status).toBe('invited')
      // Invited means no credential yet — password_hash stays null until accept.
      expect(row?.passwordHash).toBeNull()
    }

    // Exactly two invite tokens, one per invited row, still unused and unexpired.
    expect(inviteTokens).toHaveLength(2)
    expect(inviteTokens.map((t) => t.userId).sort()).toEqual(
      [FIXTURE_USER_IDS.ivy, FIXTURE_USER_IDS.mona].sort(),
    )
    for (const token of inviteTokens) {
      expect(token.usedAt).toBeNull()
      expect(token.expiresAt.getTime()).toBeGreaterThan(CLOCK_START.getTime())
    }
  })

  it('the deactivated row is retained as deactivated', async () => {
    const dan = await repo.findUserByEmail('dan@bb.test')
    expect(dan?.id).toBe(FIXTURE_USER_IDS.dan)
    expect(dan?.status).toBe('deactivated')
    // The record is kept (a status change, not a delete), so the password it had survives.
    expect(dan?.passwordHash).not.toBeNull()
  })

  it('pins deterministic ids and names for every Location', async () => {
    // super_admin scope so this pins every seeded Location, matching the fixture's own claim
    // ("every Location") rather than one branch's slice of it.
    const rows = await locations.listLocations({ role: 'super_admin', locationId: null })
    expect(rows.map((l) => l.id).sort()).toEqual(
      [FIXTURE_LOCATION_IDS.a, FIXTURE_LOCATION_IDS.b].sort(),
    )
    expect(rows.map((l) => l.name).sort()).toEqual(['Location A', 'Location B'])
  })
})

// Tally items by a derived key — small local helper so the role/status/Location assertions
// read as one expected distribution rather than a stack of per-value filters.
function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const k = key(item)
    counts[k] = (counts[k] ?? 0) + 1
  }
  return counts
}
