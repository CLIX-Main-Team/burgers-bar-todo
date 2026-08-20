import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { runMigrations } from '../../src/db/migrate.js'

export interface TestDb {
  connectionString: string
  stop: () => Promise<void>
}

// Spin an ephemeral Postgres 17 — the exact prod major (ADR-0010) — and migrate it
// fresh with the committed SQL. Real SQL, constraints, and enums, not a mock or
// SQLite (auth plan, testing approach). Callers close it via stop().
// The pgvector build of the same Postgres 17, because migration 0016 creates the vector
// extension and the retrieval tests exercise the real `<=>` scan; plain postgres:17 cannot
// even migrate past it.
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'pgvector/pgvector:pg17',
  ).start()
  const connectionString = container.getConnectionUri()
  await runMigrations(connectionString)
  return {
    connectionString,
    stop: () => container.stop(),
  }
}
