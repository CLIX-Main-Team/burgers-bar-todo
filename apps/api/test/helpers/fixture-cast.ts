import type { PreferredLanguage, Role, UserStatus } from '@burgers/shared'
import type { Clock } from '../../src/auth/clock.js'
import type { PasswordHasher } from '../../src/auth/password.js'
import type { AuthRepository } from '../../src/auth/repository.js'
import type { TokenService } from '../../src/auth/tokens.js'
import type { LocationRepository } from '../../src/locations/repository.js'

// The one new seam beneath the live e2e lane (#193, part of #151): given a fresh migrated
// database, deterministically produce the test-only **fixture cast** — 8 users spanning 3
// roles × 3 statuses × 2 Locations plus the chain-wide super_admin (2026-08-23: admin narrowed
// to a branch, so the one Location-less row is a super_admin, not an admin). The cast is built
// only over
// the seams the app already uses — createLocation, the invite (createInvitedUser) → activate
// (activateInvitedUser, which sets the password) flow, the invite token primitive, and
// deactivateUser — composed the way createAuthComponents / the integration harness compose
// them. No raw SQL and no new low-level seam: pinning a user id rides the same optional-id
// affordance createLocation already carries.
//
// This is a distinct, **test-only** concept — never the production seed. seedAdmin / seed.ts
// stay reserved for the ADR-0005 first-admin insert; nothing here is reachable from the
// production boot path, so fake people can never reach a production database.

// Pinned, deterministic UUIDs so tests can address known rows (the style people.spec.ts
// already uses for fixed Location and user ids). Locations take the 2/3 nibbles; the eight
// users take 4–b, one nibble each, so every row is identifiable at a glance:
//
//   4 Ada   5 Mia   6 Eli   7 Ivy   8 Ash   9 Mona   a Ben   b Dan
export const FIXTURE_LOCATION_IDS = {
  a: '22222222-2222-2222-2222-222222222222',
  b: '33333333-3333-3333-3333-333333333333',
} as const

export const FIXTURE_USER_IDS = {
  ada: '44444444-4444-4444-4444-444444444444',
  mia: '55555555-5555-5555-5555-555555555555',
  eli: '66666666-6666-6666-6666-666666666666',
  ivy: '77777777-7777-7777-7777-777777777777',
  ash: '88888888-8888-8888-8888-888888888888',
  mona: '99999999-9999-9999-9999-999999999999',
  ben: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  dan: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
} as const

// Only the three personas carry a password a test can sign in with; the other five never log
// in. Test-only credentials — they exist solely so the live lane can obtain a real session.
export const FIXTURE_PERSONA_PASSWORDS = {
  ada: 'FixtureAda!2026',
  mia: 'FixtureMia!2026',
  eli: 'FixtureEli!2026',
} as const

// The active-but-never-login rows (Ash, Ben, Dan) still need a password to reach `active`,
// but no test knows it. One throwaway they all share, distinct from every persona password.
const FIXTURE_UNUSED_PASSWORD = 'FixtureNoLogin!2026'

// Preferred language is left at the column default (`he`): the /people list does not render
// language, so an `he` user is fixture data no test reads. activate requires a value, so we
// pass the default explicitly to keep the whole cast uniformly at it.
const FIXTURE_LANGUAGE: PreferredLanguage = 'he'

export type FixtureUserKey = keyof typeof FIXTURE_USER_IDS

// One row of the cast, in the outward shape the /people list reports. `password` is present
// only on the three personas — its presence is exactly "this row logs in".
export interface FixtureUser {
  key: FixtureUserKey
  id: string
  email: string
  displayName: string
  role: Role
  locationId: string | null
  status: UserStatus
  password?: string
}

// The 8-row cast, declared once as data so loadFixtureCast realizes it and tests read it.
// Ordered as the spec table: 3 roles × 3 statuses × 2 Locations + the chain-wide super_admin.
export const FIXTURE_USERS: readonly FixtureUser[] = [
  {
    key: 'ada',
    id: FIXTURE_USER_IDS.ada,
    email: 'ada@bb.test',
    displayName: 'Ada Admin',
    role: 'super_admin',
    locationId: null,
    status: 'active',
    password: FIXTURE_PERSONA_PASSWORDS.ada,
  },
  {
    key: 'mia',
    id: FIXTURE_USER_IDS.mia,
    email: 'mia@bb.test',
    displayName: 'Mia Manager',
    role: 'manager',
    locationId: FIXTURE_LOCATION_IDS.a,
    status: 'active',
    password: FIXTURE_PERSONA_PASSWORDS.mia,
  },
  {
    key: 'eli',
    id: FIXTURE_USER_IDS.eli,
    email: 'eli@bb.test',
    displayName: 'Eli Employee',
    role: 'employee',
    locationId: FIXTURE_LOCATION_IDS.a,
    status: 'active',
    password: FIXTURE_PERSONA_PASSWORDS.eli,
  },
  {
    key: 'ivy',
    id: FIXTURE_USER_IDS.ivy,
    email: 'ivy@bb.test',
    displayName: 'Ivy Invitee',
    role: 'employee',
    locationId: FIXTURE_LOCATION_IDS.a,
    status: 'invited',
  },
  {
    key: 'ash',
    id: FIXTURE_USER_IDS.ash,
    email: 'ash@bb.test',
    displayName: 'Ash Active',
    role: 'employee',
    locationId: FIXTURE_LOCATION_IDS.a,
    status: 'active',
  },
  {
    key: 'mona',
    id: FIXTURE_USER_IDS.mona,
    email: 'mona@bb.test',
    displayName: 'Mona Manager',
    role: 'manager',
    locationId: FIXTURE_LOCATION_IDS.a,
    status: 'invited',
  },
  {
    key: 'ben',
    id: FIXTURE_USER_IDS.ben,
    email: 'ben@bb.test',
    displayName: 'Ben Bee',
    role: 'employee',
    locationId: FIXTURE_LOCATION_IDS.b,
    status: 'active',
  },
  {
    key: 'dan',
    id: FIXTURE_USER_IDS.dan,
    email: 'dan@bb.test',
    displayName: 'Dan Gone',
    role: 'employee',
    locationId: FIXTURE_LOCATION_IDS.b,
    status: 'deactivated',
  },
] as const

// The seams loadFixtureCast composes over — the same objects createAuthComponents +
// createLocationRepository hand the running server and the integration harness. Injected so
// this test-only path never reaches for a global or a production wiring.
export interface FixtureCastDeps {
  // Location writes — pins the two fixture Location ids the users' FK resolves against.
  locations: LocationRepository
  // Auth data access — create the pending user, activate it (set its password), deactivate.
  repo: AuthRepository
  // The argon2id hasher — the three personas' known passwords, hashed the same way sign-in
  // verifies against.
  hasher: PasswordHasher
  // The token primitive — mints the genuine single-use invite token behind each invited row.
  tokens: TokenService
  // The injected clock every timestamp and token expiry reads.
  clock: Clock
  // The invite token lifetime (mirrors AuthConfig.inviteTtlMs) so the two invited rows carry
  // a real, unexpired invite token.
  inviteTtlMs: number
}

// What a caller gets back: the pinned ids and the realized cast, so the e2e setup can sign in
// personas and address rows without re-importing the constants.
export interface FixtureCast {
  locationIds: typeof FIXTURE_LOCATION_IDS
  users: readonly FixtureUser[]
  // The three rows a test can sign in as (the ones carrying a password).
  personas: readonly FixtureUser[]
}

// Build the fixture cast against a fresh migrated database. Idempotent it is NOT — it assumes
// an empty auth/locations state (a freshly migrated DB) and throws if a write it expects to
// land does not, so a silently half-built cast can never masquerade as complete.
export async function loadFixtureCast(deps: FixtureCastDeps): Promise<FixtureCast> {
  const { locations, repo, hasher, tokens, clock, inviteTtlMs } = deps
  const now = clock.now()

  // Locations first: every located user's location_id FK resolves against these two rows.
  await locations.createLocation({ id: FIXTURE_LOCATION_IDS.a, name: 'Location A' })
  await locations.createLocation({ id: FIXTURE_LOCATION_IDS.b, name: 'Location B' })

  for (const user of FIXTURE_USERS) {
    // The invite write: a pending user with role and Location baked in, id pinned. Every row
    // begins its life here, exactly as the real provisioning path does.
    const invited = await repo.createInvitedUser({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      locationId: user.locationId,
      now,
    })
    if (!invited) {
      throw new Error(
        `loadFixtureCast: createInvitedUser wrote no row for ${user.email} — expected a fresh database`,
      )
    }

    if (user.status === 'invited') {
      // A genuine Invite: mint the real single-use invite token so an auth_tokens(purpose=
      // invite) row backs this pending user, produced by the same token primitive create-
      // invite uses. The raw value is discarded — no test accepts these invites.
      await tokens.issue(user.id, 'invite', inviteTtlMs)
      continue
    }

    // Activate: set the password and flip invited -> active. Personas get their known
    // password; the never-login rows get the shared throwaway.
    const passwordHash = await hasher.hash(user.password ?? FIXTURE_UNUSED_PASSWORD)
    const activated = await repo.activateInvitedUser({
      userId: user.id,
      passwordHash,
      preferredLanguage: FIXTURE_LANGUAGE,
      now,
    })
    if (!activated) {
      throw new Error(`loadFixtureCast: activateInvitedUser wrote no row for ${user.email}`)
    }

    if (user.status === 'deactivated') {
      // Cut access while keeping the record — the same active -> deactivated flip the app uses.
      const deactivated = await repo.deactivateUser(user.id, now)
      if (!deactivated) {
        throw new Error(`loadFixtureCast: deactivateUser wrote no row for ${user.email}`)
      }
    }
  }

  return {
    locationIds: FIXTURE_LOCATION_IDS,
    users: FIXTURE_USERS,
    personas: FIXTURE_USERS.filter((user) => user.password !== undefined),
  }
}
