import { asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import {
  type KnowledgeCategory,
  driveSyncState,
  knowledgeChunks,
  knowledgeDocs,
} from '../db/schema.js'

// The data-access layer for the knowledge cache and its sync cursor. Every method is a
// named, purpose-built operation over the two tables reconciliation owns — never a generic
// row fetch a client identifier could reach (ADR-0007). The cache is chain-wide in v1, so
// the reads here are unscoped by design; the per-principal grounding read the answer path
// needs is a later slice that adds its own scoped method parametrised by the principal.

export type KnowledgeDocStatus = 'ingested' | 'skipped'

// The category shelves live beside the table that stores them (db/schema.ts); re-exported
// here so the categorizer and the routes keep importing the knowledge surface from one place.
export { KNOWLEDGE_CATEGORIES } from '../db/schema.js'
export type { KnowledgeCategory }

// The outward view of a cache row: the reconciliation metadata (drive_file_id, modifiedTime)
// and the grounding payload (title, content, status). No timestamps or internal ids beyond
// what a reader needs — the row id is surfaced so a later scoped read can page or reference it.
export interface KnowledgeDoc {
  id: string
  driveFileId: string
  title: string
  content: string | null
  // The admin-visible reason a `skipped` doc was skipped; null for an `ingested` doc.
  skipReason: string | null
  sourceMimeType: string
  locationId: string | null
  status: KnowledgeDocStatus
  // The Knowledge-tab shelf, or null while the doc awaits the categorizer's next sweep.
  category: KnowledgeCategory | null
  driveModifiedTime: Date
}

// One reconciled file to write, keyed on drive_file_id for upsert. locationId is null in v1
// (every doc is chain-wide, ADR-0014); it is threaded rather than hard-coded so per-location
// tagging is an additive caller change. The timestamps come from the injected clock so the
// whole flow reads one controllable time source, as the auth writes do.
export interface UpsertKnowledgeDocInput {
  driveFileId: string
  title: string
  content: string | null
  // The reason a skipped doc could not be read, or null for an ingested one. Written
  // alongside status so the two never disagree (ingested ⇒ null, skipped ⇒ a reason).
  skipReason: string | null
  sourceMimeType: string
  locationId: string | null
  status: KnowledgeDocStatus
  driveModifiedTime: Date
  now: Date
}

export interface KnowledgeRepository {
  // Insert the reconciled file or, on a repeat drive_file_id, overwrite the mutable fields
  // in place — so a re-synced edit updates the existing row and never duplicates it.
  upsertDoc(input: UpsertKnowledgeDocInput): Promise<void>
  // Remove a file's cache row by its Drive id. Idempotent: a file that is not cached (already
  // deleted, or never ingested) deletes zero rows and is left as it is.
  deleteDocByDriveFileId(driveFileId: string): Promise<void>
  // Remove every cached doc whose Drive id is NOT in the given listing, returning how many went.
  // The full load's reconciliation of deletions: the changes feed reports a removal only while a
  // cursor exists, so anything deleted from Drive outside that window is invisible to the
  // incremental path and would otherwise answer questions forever. Callers pass a non-empty
  // listing (see knowledge-sync.ts) — an empty one here would clear the whole cache, so the
  // decision about whether an empty listing is trustworthy is deliberately left to the caller.
  deleteDocsNotIn(driveFileIds: string[]): Promise<number>
  // The persisted changes cursor, or undefined before the first sync has seeded it.
  getSyncCursor(): Promise<string | undefined>
  // Advance the single-row cursor to a page token (inserting the row on the first sync).
  setSyncCursor(pageToken: string, now: Date): Promise<void>
  // Read a single cached file by its Drive id, or undefined when it is not cached — the
  // follow-up read that observes what a sync did to one file.
  getDocByDriveFileId(driveFileId: string): Promise<KnowledgeDoc | undefined>
  // The ingested docs grounding would inject — the answerable corpus. Skipped rows are
  // excluded because they carry no readable content to ground on.
  listIngestedDocs(): Promise<KnowledgeDoc[]>
  // Every cached doc, skipped rows included — the admin Knowledge tab's read (ADR-0024),
  // where a skipped doc is shown with its reason rather than hidden. Title-ordered so the
  // tab renders a stable listing without sorting client-side.
  listAllDocs(): Promise<KnowledgeDoc[]>
  // The docs still awaiting a category — the categorizer's work queue after each sync.
  listUncategorizedDocs(): Promise<KnowledgeDoc[]>
  // File one doc under a category shelf, keyed by Drive id like the sync writes. Idempotent
  // and last-write-wins, matching the upsert posture.
  setDocCategory(driveFileId: string, category: KnowledgeCategory, now: Date): Promise<void>
  // When the last sync pass finished — the cursor row's updated_at, or undefined before the
  // first sync. The Knowledge tab's "last synced" header line.
  getLastSyncAt(): Promise<Date | undefined>
  // --- The retrieval index over the cache (ADR-0025) ---
  // Ingested docs whose chunk rows are missing — the chunker's work queue after each sync.
  // upsertDoc clears a doc's chunks whenever it writes, so an edited doc re-queues itself.
  listDocsNeedingChunks(): Promise<{ id: string; title: string; content: string }[]>
  // Write one doc's chunks in original order, embeddings pending. Replaces nothing: the
  // caller only reaches a doc listDocsNeedingChunks named, whose chunks are already cleared.
  insertChunks(docId: string, chunks: string[], now: Date): Promise<void>
  // Chunks the index pass still owes work on — its work queue. Carries the parent title because
  // the indexed text is title-prefixed (the title carries the topic). `withGist` widens the queue
  // to chunks that have a vector but no other-language gist, which is how the bridge reaches an
  // already-embedded corpus without discarding its vectors: a gist backfill costs completions,
  // while nulling embeddings to force the queue would blind retrieval until the pass finished.
  // It is false when no LLM is wired — otherwise gist-less chunks would re-queue forever.
  listChunksNeedingIndex(
    withGist: boolean,
  ): Promise<{ id: string; docTitle: string; content: string }[]>
  // Attach vectors and their other-language gists to chunks, one write per backfilled batch.
  setChunkEmbeddings(
    updates: { id: string; embedding: number[]; gist: string | null }[],
    now: Date,
  ): Promise<void>
  // Every chunk of every ingested doc with its parent title — what the answer path retrieves
  // over. Ordered by title then position so ranking ties resolve deterministically.
  listGroundingChunks(): Promise<KnowledgeChunk[]>
}

// One retrieval unit as the answer path reads it (ADR-0025): a piece of an ingested doc,
// its parent's title (the grounding heading and citation key), and its vector — null while
// the backfill has not reached it, in which case only keyword ranking can see it.
export interface KnowledgeChunk {
  docId: string
  docTitle: string
  chunkIndex: number
  content: string
  embedding: number[] | null
  // The chunk restated in the other language, null until the index pass reaches it (or when no
  // LLM is wired). Retrieval matches words against it so a question can find a document written
  // in the language the asker did not use; the model never sees it — it reads `content`.
  gist: string | null
}

// The columns every KnowledgeDoc read selects — one place, so the reads return an identical
// outward shape.
const knowledgeDocColumns = {
  id: knowledgeDocs.id,
  driveFileId: knowledgeDocs.driveFileId,
  title: knowledgeDocs.title,
  content: knowledgeDocs.content,
  skipReason: knowledgeDocs.skipReason,
  sourceMimeType: knowledgeDocs.sourceMimeType,
  locationId: knowledgeDocs.locationId,
  status: knowledgeDocs.status,
  category: knowledgeDocs.category,
  driveModifiedTime: knowledgeDocs.driveModifiedTime,
} as const

// The fixed primary key of the single-row cursor store. The table's CHECK pins id = true, so
// there is exactly one row for the one chain-wide corpus.
const SYNC_STATE_ID = true

export function createKnowledgeRepository(db: Db): KnowledgeRepository {
  return {
    upsertDoc: async ({
      driveFileId,
      title,
      content,
      skipReason,
      sourceMimeType,
      locationId,
      status,
      driveModifiedTime,
      now,
    }) => {
      await db
        .insert(knowledgeDocs)
        .values({
          driveFileId,
          title,
          content,
          skipReason,
          sourceMimeType,
          locationId,
          status,
          driveModifiedTime,
          createdAt: now,
          updatedAt: now,
        })
        // A repeat drive_file_id conflicts on its unique index and overwrites the mutable
        // fields — title, content, skip_reason, mime, status, the Drive revision, updated_at
        // — while the row id and created_at stay put. Overwriting skip_reason matters: a doc
        // that gains a text layer flips skipped → ingested and must clear its stale reason.
        // The category survives a content edit but resets to NULL on a rename (ADR-0024): a
        // new title is the one signal a doc may belong on a different shelf, and NULL puts it
        // back in the categorizer's queue without re-filing every doc a quiet edit touches.
        .onConflictDoUpdate({
          target: knowledgeDocs.driveFileId,
          set: {
            title,
            content,
            skipReason,
            sourceMimeType,
            status,
            driveModifiedTime,
            updatedAt: now,
            category: sql`CASE WHEN ${knowledgeDocs.title} IS DISTINCT FROM excluded.title THEN NULL ELSE ${knowledgeDocs.category} END`,
          },
        })
      // A write may have changed the content, so the doc's retrieval chunks are stale: clear
      // them and let the next chunking pass rebuild (ADR-0025). Unconditional — a no-op for a
      // fresh row, and cheaper than diffing content for the rare metadata-only change.
      await db
        .delete(knowledgeChunks)
        .where(
          inArray(
            knowledgeChunks.docId,
            db
              .select({ id: knowledgeDocs.id })
              .from(knowledgeDocs)
              .where(eq(knowledgeDocs.driveFileId, driveFileId)),
          ),
        )
    },

    deleteDocByDriveFileId: async (driveFileId) => {
      await db.delete(knowledgeDocs).where(eq(knowledgeDocs.driveFileId, driveFileId))
    },

    deleteDocsNotIn: async (driveFileIds) => {
      if (driveFileIds.length === 0) {
        return 0
      }
      const removed = await db
        .delete(knowledgeDocs)
        .where(notInArray(knowledgeDocs.driveFileId, driveFileIds))
        .returning({ id: knowledgeDocs.id })
      return removed.length
    },

    getSyncCursor: async () => {
      const rows = await db
        .select({ pageToken: driveSyncState.pageToken })
        .from(driveSyncState)
        .where(eq(driveSyncState.id, SYNC_STATE_ID))
        .limit(1)
      // The row is absent before the first sync, and its page_token is non-null once seeded;
      // both cases read as "no cursor yet" so the caller obtains a start page token.
      return rows[0]?.pageToken ?? undefined
    },

    setSyncCursor: async (pageToken, now) => {
      await db
        .insert(driveSyncState)
        .values({ id: SYNC_STATE_ID, pageToken, updatedAt: now })
        .onConflictDoUpdate({
          target: driveSyncState.id,
          set: { pageToken, updatedAt: now },
        })
    },

    getDocByDriveFileId: async (driveFileId) => {
      const rows = await db
        .select(knowledgeDocColumns)
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.driveFileId, driveFileId))
        .limit(1)
      return rows[0]
    },

    listIngestedDocs: async () => {
      return db
        .select(knowledgeDocColumns)
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.status, 'ingested'))
    },

    listAllDocs: async () => {
      return db.select(knowledgeDocColumns).from(knowledgeDocs).orderBy(asc(knowledgeDocs.title))
    },

    listUncategorizedDocs: async () => {
      return db
        .select(knowledgeDocColumns)
        .from(knowledgeDocs)
        .where(isNull(knowledgeDocs.category))
        .orderBy(asc(knowledgeDocs.title))
    },

    setDocCategory: async (driveFileId, category, now) => {
      await db
        .update(knowledgeDocs)
        .set({ category, updatedAt: now })
        .where(eq(knowledgeDocs.driveFileId, driveFileId))
    },

    getLastSyncAt: async () => {
      const rows = await db
        .select({ updatedAt: driveSyncState.updatedAt })
        .from(driveSyncState)
        .where(eq(driveSyncState.id, SYNC_STATE_ID))
        .limit(1)
      return rows[0]?.updatedAt
    },

    listDocsNeedingChunks: async () => {
      const rows = await db
        .select({
          id: knowledgeDocs.id,
          title: knowledgeDocs.title,
          content: knowledgeDocs.content,
        })
        .from(knowledgeDocs)
        .where(
          sql`${knowledgeDocs.status} = 'ingested' AND ${knowledgeDocs.content} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${knowledgeChunks} WHERE ${knowledgeChunks.docId} = ${knowledgeDocs.id})`,
        )
        .orderBy(asc(knowledgeDocs.title))
      // content is non-null by the predicate; narrow it for the caller.
      return rows.map((row) => ({ id: row.id, title: row.title, content: row.content ?? '' }))
    },

    insertChunks: async (docId, chunks, now) => {
      if (chunks.length === 0) {
        return
      }
      await db.insert(knowledgeChunks).values(
        chunks.map((content, chunkIndex) => ({
          docId,
          chunkIndex,
          content,
          updatedAt: now,
        })),
      )
    },

    listChunksNeedingIndex: async (withGist) => {
      return db
        .select({
          id: knowledgeChunks.id,
          docTitle: knowledgeDocs.title,
          content: knowledgeChunks.content,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(
          withGist
            ? or(isNull(knowledgeChunks.embedding), isNull(knowledgeChunks.gist))
            : isNull(knowledgeChunks.embedding),
        )
        .orderBy(asc(knowledgeDocs.title), asc(knowledgeChunks.chunkIndex))
    },

    setChunkEmbeddings: async (updates, now) => {
      for (const { id, embedding, gist } of updates) {
        await db
          .update(knowledgeChunks)
          .set({ embedding, gist, updatedAt: now })
          .where(eq(knowledgeChunks.id, id))
      }
    },

    listGroundingChunks: async () => {
      return db
        .select({
          docId: knowledgeChunks.docId,
          docTitle: knowledgeDocs.title,
          chunkIndex: knowledgeChunks.chunkIndex,
          content: knowledgeChunks.content,
          embedding: knowledgeChunks.embedding,
          gist: knowledgeChunks.gist,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(eq(knowledgeDocs.status, 'ingested'))
        .orderBy(asc(knowledgeDocs.title), asc(knowledgeChunks.chunkIndex))
    },
  }
}
