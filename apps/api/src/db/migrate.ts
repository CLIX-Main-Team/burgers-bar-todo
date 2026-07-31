import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { loadRootEnv } from '../load-env.js'
import { createDb } from './client.js'

// The migrations folder holds the committed, versioned SQL produced by
// `drizzle-kit generate` (no push — ADR-0010). It sits next to apps/api's root.
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

// Apply all committed migrations against a connection. Reused by `make migrate`
// and by the integration-test harness, which migrates a fresh Postgres per run.
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString)
  try {
    await migrate(db, { migrationsFolder })
  } finally {
    await pool.end()
  }
}

// Entry point for `npm run db:migrate` / `make migrate`.
async function main(): Promise<void> {
  loadRootEnv()
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations.')
  }
  await runMigrations(connectionString)
  console.log('Migrations applied.')
}

// Run only when invoked directly, not when imported by the test harness.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
