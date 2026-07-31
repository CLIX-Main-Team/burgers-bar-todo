import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { runMigrations } from '../../src/db/migrate.js'

export interface TestDb {
  connectionString: string
  stop: () => Promise<void>
}

// Spin an ephemeral Postgres 17 — the exact prod major (ADR-0010) — and migrate it
// fresh with the committed SQL. Real SQL, constraints, and enums, not a mock or
// SQLite (auth plan, testing approach). Callers close it via stop().
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17').start()
  const connectionString = container.getConnectionUri()
  await runMigrations(connectionString)
  return {
    connectionString,
    stop: () => container.stop(),
  }
}
