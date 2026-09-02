import { createHash } from 'node:crypto'
import type { Role } from '@burgers/shared'
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import {
  type Department,
  type DocType,
  type KnowledgeCategory,
  type Sensitivity,
  driveSyncState,
  knowledgeChunks,
  knowledgeDocs,
} from '../db/schema.js'
import { type KnowledgeScope, scopedSensitivities } from './document-metadata.js'

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
  // The deterministic classification (document-metadata.ts). department and docType are
  // descriptive; sensitivity is the access key the grounding read filters on.
  department: Department | null
  docType: DocType | null
  sensitivity: Sensitivity
  driveModifiedTime: Date
  // When the stored content was produced by the visual transcriber rather than read from the
  // file itself; null for authored text. The machine-provenance tag the content no longer carries.
  transcribedAt: Date | null
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
  // Classified by the caller from the document's folder and filename, so the rules stay one pure
  // function with one call site rather than something the data layer re-derives.
  department: Department
  docType: DocType
  sensitivity: Sensitivity
  driveModifiedTime: Date
  // True when `content` came out of the visual transcriber (2026-09 phase 2), stamping the row's
  // transcribed_at. Optional so the many test callers that never transcribe stay untouched.
  transcribed?: boolean
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
  listAllDocs(scope: KnowledgeScope): Promise<KnowledgeDoc[]>
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
  // It also claims rows whose stored vector came from a DIFFERENT model than the one now
  // configured: those vectors live in another embedding space, so comparing them against a fresh
  // query vector yields noise, and before the model was recorded such a swap was undetectable.
  // Each row carries any gist it already has, so a pass that failed after buying gists but before
  // embedding does not buy them again.
  listChunksNeedingIndex(
    withGist: boolean,
    embeddingModel?: string,
  ): Promise<{ id: string; docTitle: string; content: string; gist: string | null }[]>
  // Persist gists on their own, before the embedding call they were generated for. They cost a
  // premium completion each and used to be written only alongside the vectors, so any embedding
  // failure threw a whole batch of paid gists away and the next pass bought them all over again.
  setChunkGists(updates: { id: string; gist: string }[], now: Date): Promise<void>
  // Attach vectors and their other-language gists to chunks, one write per backfilled batch, with
  // the model and width that produced them.
  setChunkEmbeddings(
    updates: { id: string; embedding: number[]; gist: string | null }[],
    model: string,
    now: Date,
  ): Promise<void>
  // Every chunk of every ingested doc the given role may read, with its parent title — what the
  // answer path retrieves over. Ordered by title then position so ranking ties resolve
  // deterministically. The role is a parameter and not a filter the caller applies afterwards,
  // because a chunk the caller must not see should never be loaded in the first place.
  // Carries whether each chunk is embedded but never the vector itself: the cosine ranking now
  // runs in the database (searchChunksByVector), so hauling every stored vector into Node on
  // every question — the in-process design's real scaling ceiling — buys nothing.
  // `shelves` narrows the read to those Knowledge-tab categories (ADR-0024) — the checklist scan
  // passes the shelves that hold instructions, because a dashboard is not a procedure however
  // well it matches the words. Omitted, the whole readable corpus is returned, which is what the
  // answer path wants. Unfiled docs (category still NULL, the window between a sync and the
  // categorizer's next pass) are always included: a brand-new checklist invisible to every scan
  // for twenty minutes is a worse failure than a little noise.
  listGroundingChunks(
    scope: KnowledgeScope,
    shelves?: readonly KnowledgeCategory[],
  ): Promise<KnowledgeChunk[]>
  // The vector arm's ranking for ONE query variant, computed where the vectors live: pgvector's
  // `<=>` cosine distance over exactly the rows the role may read, best first, capped. An exact
  // scan by design — no hnsw/ivfflat index exists yet, because at up to tens of thousands of rows
  // a flat scan is fast and 100% recall, while an index would bring pgvector 0.8's post-filter
  // recall trap in for nothing (the documented upgrade path once the corpus is ~50k chunks).
  // The floor/band relevance policy stays in retrieval.ts — this returns candidates, not policy.
  searchChunksByVector(
    scope: KnowledgeScope,
    queryVector: number[],
    limit: number,
    // The same shelf narrowing as listGroundingChunks. Both arms of one retrieval must read the
    // same rows, so a caller that narrows one narrows the other with the identical list.
    shelves?: readonly KnowledgeCategory[],
  ): Promise<VectorHit[]>
}

// One vector-arm candidate: which chunk (by id, joining it back to listGroundingChunks' rows),
// and its cosine similarity to the query variant, already 1 - distance so bigger is better.
export interface VectorHit {
  id: string
  score: number
}

// One retrieval unit as the answer path reads it (ADR-0025): a piece of an ingested doc and
// its parent's title (the grounding heading and citation key). `embedded` says whether the
// backfill has reached it — false means only keyword ranking can see it, and retrieval's
// keyword-alone gate reads the flag to tell a healthy index from a filling one. The vector
// itself never rides along: similarity is computed in the database.
export interface KnowledgeChunk {
  id: string
  docId: string
  docTitle: string
  chunkIndex: number
  content: string
  embedded: boolean
  // The chunk restated in the other language, null until the index pass reaches it (or when no
  // LLM is wired). Retrieval matches words against it so a question can find a document written
  // in the language the asker did not use; the model never sees it — it reads `content`.
  gist: string | null
}

// The shelf narrowing both retrieval arms apply (2026-08-27), written once so the two reads can
// never drift into looking at different rows. Undefined means every shelf. An unfiled doc always
// passes: category is NULL only between a sync and the categorizer's next pass, and a checklist
// that lands during that window must still be findable.
const shelfPredicate = (shelves: readonly KnowledgeCategory[] | undefined) =>
  shelves === undefined
    ? undefined
    : or(isNull(knowledgeDocs.category), inArray(knowledgeDocs.category, [...shelves]))

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
  department: knowledgeDocs.department,
  docType: knowledgeDocs.docType,
  sensitivity: knowledgeDocs.sensitivity,
  driveModifiedTime: knowledgeDocs.driveModifiedTime,
  transcribedAt: knowledgeDocs.transcribedAt,
} as const

// The fingerprint a re-sync compares to decide whether anything actually changed. Title as well as
// content, because the title is prepended to the text a chunk is embedded as and is named in the
// gist prompt, so a rename genuinely changes the index even though the stored chunk text is bare.
// A Drive move or a sharing tweak changes neither, which is the case this exists to make free.
const fingerprintOf = (title: string, content: string | null): string =>
  createHash('sha256')
    .update(`${title}
${content ?? ''}`)
    .digest('hex')

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
      department,
      docType,
      sensitivity,
      driveModifiedTime,
      transcribed = false,
      now,
    }) => {
      const contentHash = fingerprintOf(title, content)
      // The previous fingerprint, read before the upsert overwrites it. One indexed lookup against
      // a download, an extraction, and a gist completion per chunk is not a cost worth optimising.
      const [previous] = await db
        .select({ contentHash: knowledgeDocs.contentHash })
        .from(knowledgeDocs)
        .where(eq(knowledgeDocs.driveFileId, driveFileId))
        .limit(1)

      await db
        .insert(knowledgeDocs)
        .values({
          driveFileId,
          title,
          content,
          contentHash,
          skipReason,
          sourceMimeType,
          locationId,
          status,
          department,
          docType,
          sensitivity,
          driveModifiedTime,
          transcribedAt: transcribed ? now : null,
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
            contentHash,
            skipReason,
            sourceMimeType,
            status,
            department,
            docType,
            sensitivity,
            driveModifiedTime,
            // Overwritten both ways on purpose: a doc that gains a real text version flips back
            // to authored (null), and a re-transcribed one re-stamps.
            transcribedAt: transcribed ? now : null,
            updatedAt: now,
            category: sql`CASE WHEN ${knowledgeDocs.title} IS DISTINCT FROM excluded.title THEN NULL ELSE ${knowledgeDocs.category} END`,
          },
        })
      // Clear the doc's retrieval chunks only when the indexed text actually changed, so the next
      // chunking pass rebuilds them (ADR-0025).
      //
      // This used to be unconditional, and the comment justifying it — that diffing content was
      // dearer than re-chunking — was written when re-chunking meant re-splitting a string. Since
      // the language bridge it means one premium completion per chunk plus a fresh embedding for
      // every chunk of the document. Drive reports a change for a rename, a move, a sharing tweak,
      // or a folder-level edit that fans out to every file beneath it, and each of those re-bought
      // the lot for text that had not changed by a byte: dragging a thirty-document folder cost
      // roughly seventy gist completions and pushed all thirty documents through a window where
      // they had no chunks at all. Notion measured a 70% cut in processed volume from exactly this
      // comparison. A row with no stored fingerprint — written before the column existed — reads as
      // changed, so it is re-processed once and then settles.
      if (previous?.contentHash !== contentHash) {
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
      }
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

    listAllDocs: async (scope) => {
      // The Knowledge page's file list, scoped by the same ladder the assistant's grounding
      // reads use. A title is content: "Herzliya lease — renewal terms" tells a manager what the
      // document they may not open is about, so the list a role may not read from is a list they
      // do not see (owner ask 2026-08-26, making knowledge.view real end to end).
      return db
        .select(knowledgeDocColumns)
        .from(knowledgeDocs)
        .where(inArray(knowledgeDocs.sensitivity, scopedSensitivities(scope)))
        .orderBy(asc(knowledgeDocs.title))
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

    listChunksNeedingIndex: async (withGist, embeddingModel) => {
      const missingVector = isNull(knowledgeChunks.embedding)
      const staleModel =
        embeddingModel === undefined
          ? undefined
          : and(
              isNotNull(knowledgeChunks.embedding),
              or(
                isNull(knowledgeChunks.embeddingModel),
                ne(knowledgeChunks.embeddingModel, embeddingModel),
              ),
            )
      const claims = [missingVector]
      if (withGist) {
        claims.push(isNull(knowledgeChunks.gist))
      }
      if (staleModel) {
        claims.push(staleModel)
      }
      return db
        .select({
          id: knowledgeChunks.id,
          docTitle: knowledgeDocs.title,
          content: knowledgeChunks.content,
          gist: knowledgeChunks.gist,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(claims.length === 1 ? missingVector : or(...claims))
        .orderBy(asc(knowledgeDocs.title), asc(knowledgeChunks.chunkIndex))
    },

    setChunkGists: async (updates, now) => {
      if (updates.length === 0) {
        return
      }
      const rows = updates.map(({ id, gist }) => sql`(${id}::uuid, ${gist}::text)`)
      await db.execute(sql`
        update ${knowledgeChunks} as c
        set gist = v.gist, updated_at = ${now}
        from (values ${sql.join(rows, sql`, `)}) as v(id, gist)
        where c.id = v.id
      `)
    },

    setChunkEmbeddings: async (updates, model, now) => {
      if (updates.length === 0) {
        return
      }
      // One statement per batch rather than one per chunk. At ninety chunks the round trips were
      // merely wasteful; a few hundred documents makes them thousands.
      const rows = updates.map(
        ({ id, embedding, gist }) =>
          sql`(${id}::uuid, ${JSON.stringify(embedding)}::vector(1024), ${gist}::text, ${embedding.length}::integer)`,
      )
      await db.execute(sql`
        update ${knowledgeChunks} as c
        set embedding = v.embedding,
            gist = v.gist,
            embedding_model = ${model},
            embedding_dim = v.dim,
            updated_at = ${now}
        from (values ${sql.join(rows, sql`, `)}) as v(id, embedding, gist, dim)
        where c.id = v.id
      `)
    },

    listGroundingChunks: async (scope, shelves) => {
      // The sensitivity filter is part of the query, not a post-filter and not a prompt instruction:
      // lease terms and payroll sheets sit in the same corpus as the opening procedure, so before
      // this every employee's question ranked over all of them and a well-aimed one was answered
      // from them. A role that may not read a level never has those rows in memory, so no later bug
      // can leak what was never fetched — ADR-0007's rule, applied to the corpus the way
      // listScopedTasks already applies it to the board.
      return db
        .select({
          id: knowledgeChunks.id,
          docId: knowledgeChunks.docId,
          docTitle: knowledgeDocs.title,
          chunkIndex: knowledgeChunks.chunkIndex,
          content: knowledgeChunks.content,
          embedded: sql<boolean>`(${knowledgeChunks.embedding} is not null)`,
          gist: knowledgeChunks.gist,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(
          and(
            eq(knowledgeDocs.status, 'ingested'),
            inArray(knowledgeDocs.sensitivity, scopedSensitivities(scope)),
            shelfPredicate(shelves),
          ),
        )
        .orderBy(asc(knowledgeDocs.title), asc(knowledgeChunks.chunkIndex))
    },

    searchChunksByVector: async (scope, queryVector, limit, shelves) => {
      // The same visibility predicate as listGroundingChunks, verbatim: the two reads are the two
      // halves of one retrieval, and a chunk the role may not read must be absent from both.
      // Ordered by distance with the grounding read's title/position order as the tie-break, so a
      // score tie ranks the same chunk first in both worlds and selection stays deterministic.
      const query = sql`${JSON.stringify(queryVector)}::vector(1024)`
      return db
        .select({
          id: knowledgeChunks.id,
          score: sql<number>`1 - (${knowledgeChunks.embedding} <=> ${query})`,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
        .where(
          and(
            eq(knowledgeDocs.status, 'ingested'),
            inArray(knowledgeDocs.sensitivity, scopedSensitivities(scope)),
            shelfPredicate(shelves),
            isNotNull(knowledgeChunks.embedding),
          ),
        )
        .orderBy(
          sql`${knowledgeChunks.embedding} <=> ${query}`,
          asc(knowledgeDocs.title),
          asc(knowledgeChunks.chunkIndex),
        )
        .limit(limit)
    },
  }
}
