import { sql } from 'drizzle-orm'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import { type AssistantComponents, createAssistantComponents } from '../../src/assistant/wire.js'
import { type MutableClock, createMutableClock } from '../../src/auth/clock.js'
import { createDb } from '../../src/db/client.js'
import { type TestDb, startTestDb } from './test-db.js'

export interface AssistantHarness {
  // The assistant components the server wires, driven directly: reconcile through the sync
  // service, observe cache state through the repository's follow-up reads. There is no HTTP
  // route in this slice (the resync endpoint and the answer path are later tickets), so the
  // module's own read API is the observation seam — the follow-up read, not a raw row select.
  components: AssistantComponents
  // The scriptable fake Drive: a test mutates the corpus through it (putDoc/removeFile) and
  // reads its call counts to prove single-flight. The only substitution besides the clock.
  drive: FakeDriveClient
  // The injected clock; assistant writes stamp their timestamps from it.
  clock: MutableClock
  // The per-document errors the first full load reported and skipped best-effort (ADR-0021) — the
  // proof one unreadable document did not block the rest of the corpus, seen as external behaviour.
  documentErrors: { driveFileId: string; error: unknown }[]
  // Wipe cache and cursor state between tests so cases do not leak into one another.
  reset: () => Promise<void>
  close: () => Promise<void>
}

// The integration seam for the assistant slice: a fresh migrated Postgres (real SQL, enums,
// constraints — not a mock or SQLite), a mutable clock, and the fake Drive at the module's
// composition point, so the sync runs with no network and is deterministic. Tests assert on
// external behaviour only — cache state seen through a repository read after a sync — never by
// reading rows or internals directly.
export async function createAssistantHarness(): Promise<AssistantHarness> {
  const testDb = await startTestDb()
  const { db, pool } = createDb(testDb.connectionString)

  const clockStart = new Date('2026-01-01T00:00:00.000Z')
  const clock = createMutableClock(clockStart)
  const drive = createFakeDriveClient()
  const documentErrors: { driveFileId: string; error: unknown }[] = []
  const components = createAssistantComponents(db, clock, drive, {
    sync: { onDocumentError: (driveFileId, error) => documentErrors.push({ driveFileId, error }) },
  })

  return {
    components,
    drive,
    clock,
    documentErrors,
    reset: async () => {
      await db.execute(sql`truncate table knowledge_docs, drive_sync_state`)
      clock.set(clockStart)
      drive.reset()
      documentErrors.length = 0
    },
    close: async () => {
      await pool.end()
      await testDb.stop()
    },
  }
}
