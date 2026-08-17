import { sql } from 'drizzle-orm'
import { type FakeDriveClient, createFakeDriveClient } from '../../src/assistant/drive-client.js'
import { type FakeLlmClient, createFakeLlmClient } from '../../src/assistant/llm-client.js'
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
  // The scriptable fake LLM the knowledge categorizer files docs with (ADR-0024): a test
  // scripts its replies per title and reads its captured requests, mirroring the fake Drive.
  llm: FakeLlmClient
  // The per-document errors the first full load reported and skipped best-effort (ADR-0021) — the
  // proof one unreadable document did not block the rest of the corpus, seen as external behaviour.
  documentErrors: { driveFileId: string; error: unknown }[]
  // The docs a categorizer sweep failed to file (transport failures, ADR-0024) — left NULL for
  // the next pass, reported here as the error class only.
  categoryErrors: { driveFileId: string; error: string }[]
  // Wipe cache and cursor state between tests so cases do not leak into one another.
  reset: () => Promise<void>
  // Drop ONLY the persisted cursor, leaving cached docs in place — the state a long outage or a
  // hand-recovery leaves behind, and the one where a full load has to reconcile deletions.
  clearCursor: () => Promise<void>
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
  const llm = createFakeLlmClient()
  // Unless a test scripts otherwise, the fake files everything under the `general` floor —
  // a recognizable slug, so default runs behave like an obedient model.
  llm.setDefaultAnswer('general')
  const documentErrors: { driveFileId: string; error: unknown }[] = []
  const categoryErrors: { driveFileId: string; error: string }[] = []
  const components = createAssistantComponents(db, clock, drive, {
    sync: { onDocumentError: (driveFileId, error) => documentErrors.push({ driveFileId, error }) },
    llm,
    categorizer: {
      onCategoryError: (driveFileId, error) => categoryErrors.push({ driveFileId, error }),
    },
  })

  return {
    components,
    drive,
    clock,
    llm,
    documentErrors,
    categoryErrors,
    clearCursor: async () => {
      await db.execute(sql`truncate table drive_sync_state`)
    },
    reset: async () => {
      await db.execute(sql`truncate table knowledge_docs, knowledge_chunks, drive_sync_state`)
      clock.set(clockStart)
      drive.reset()
      llm.reset()
      llm.setDefaultAnswer('general')
      documentErrors.length = 0
      categoryErrors.length = 0
    },
    close: async () => {
      await pool.end()
      await testDb.stop()
    },
  }
}
