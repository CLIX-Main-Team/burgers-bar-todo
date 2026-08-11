import { asc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { type KnowledgeCategory, driveSyncState, knowledgeDocs } from '../db/schema.js'

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
    },

    deleteDocByDriveFileId: async (driveFileId) => {
      await db.delete(knowledgeDocs).where(eq(knowledgeDocs.driveFileId, driveFileId))
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
  }
}
