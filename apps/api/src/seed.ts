import { z } from 'zod'
import { createPasswordHasher } from './auth/password.js'
import { createAuthRepository } from './auth/repository.js'
import { seedAdmin } from './auth/seed-admin.js'
import { createDb } from './db/client.js'
import { loadRootEnv } from './load-env.js'

// Seed the first admin — idempotent, env-driven (ADR-0005, ADR-0010). This is the
// `make seed` front door and, in prod, the one-off insert of ADR-0005. Running it
// again never duplicates or overwrites the admin (see seedAdmin / upsertSeedAdmin).
//
// The credentials and connection string are read here, at the CLI edge, and never at
// API boot — a running server does not need the seed password. The seed logic itself
// lives in seedAdmin so the integration suite exercises the same path in-process.

const seedEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // Trimmed so a stray space in the configured value cannot make the seeded email
  // disagree with sign-in, which trims its input too.
  SEED_ADMIN_EMAIL: z.string().trim().email(),
  SEED_ADMIN_PASSWORD: z.string().min(1),
  SEED_ADMIN_DISPLAY_NAME: z.string().optional(),
})

async function main(): Promise<void> {
  loadRootEnv()
  const parsed = seedEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Cannot seed — invalid environment:\n${issues}`)
  }
  const env = parsed.data

  const { db, pool } = createDb(env.DATABASE_URL)
  try {
    // The seed only writes a user; it needs the repository and the hasher, not the
    // session machinery, so it wires just those two rather than the whole module.
    const repo = createAuthRepository(db)
    const hasher = createPasswordHasher()
    await seedAdmin(repo, hasher, {
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      displayName: env.SEED_ADMIN_DISPLAY_NAME,
    })
    console.log(`seed: ensured admin ${env.SEED_ADMIN_EMAIL} exists (idempotent).`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
