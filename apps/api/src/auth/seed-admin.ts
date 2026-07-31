import type { PasswordHasher } from './password.js'
import type { AuthRepository } from './repository.js'

export interface SeedAdminCredentials {
  email: string
  password: string
  // The admin's display name. Optional so the CLI can fall back to a sensible
  // default; an inviter sets real names, but the seeded first admin has no inviter.
  displayName?: string
}

// Seed the first admin (ADR-0005, stories 1-2): hash the configured password through
// the same argon2id path sign-in verifies against, then upsert exactly one active
// admin. Idempotent — the repository's insert does nothing on an email conflict, so a
// second run neither duplicates nor overwrites. This is the in-process core; the CLI
// (src/seed.ts) is the `make seed` wrapper, and the integration tests call this
// directly against the test database with the same wiring the API uses.
export async function seedAdmin(
  repo: AuthRepository,
  hasher: PasswordHasher,
  credentials: SeedAdminCredentials,
): Promise<void> {
  const passwordHash = await hasher.hash(credentials.password)
  await repo.upsertSeedAdmin({
    email: credentials.email,
    displayName: credentials.displayName ?? 'Administrator',
    passwordHash,
  })
}
