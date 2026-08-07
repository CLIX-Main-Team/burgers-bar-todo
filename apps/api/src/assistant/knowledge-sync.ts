import type { Clock } from '../auth/clock.js'
import {
  DOCX_MIME_TYPE,
  type ExtractionOutcome,
  HTML_MIME_TYPE,
  PDF_MIME_TYPE,
  XLSX_MIME_TYPE,
  extractDocx,
  extractHtml,
  extractPdf,
  extractXlsx,
  ingestAuthoredText,
} from './document-extraction.js'
import {
  type DriveChange,
  type DriveClient,
  type DriveFileMetadata,
  GOOGLE_DOC_MIME_TYPE,
} from './drive-client.js'
import type { KnowledgeRepository } from './repository.js'

// The one idempotent reconciliation pass that keeps the knowledge cache consistent with the
// Drive corpus (ADR-0004, ADR-0014, ADR-0021). It has two branches on the persisted cursor:
//
//   - No cursor (the knowledge base has never synced) ⇒ a FULL LOAD: capture the changes cursor
//     first, list every document currently in the folder, ingest each best-effort, then persist
//     the cursor last. This is what fills an already-populated folder on a fresh deployment —
//     the docs authored before the cursor exists are never in the changes feed, so listing the
//     folder is the only way to pick them up (ADR-0021 amends ADR-0014's changes-feed-only model).
//   - A cursor exists ⇒ an INCREMENTAL reconcile: walk `changes.list` from the persisted cursor,
//     upsert or delete each cache row keyed on drive_file_id, and advance the cursor.
//
// Calling it repeatedly converges the cache and is safe. It is single-flight: a crowd of concurrent
// callers (the boot fire plus the first interval tick) collapses onto one sync in flight, so Drive
// is walked once.
//
// Five corpus formats are ingested (#88): a Google Doc via `files.export`, and a text-layer PDF,
// a Word document, an Excel workbook, or an HTML page downloaded and run through
// document-extraction.ts. A format the system cannot read (a scanned/image-only PDF) is upserted
// as `skipped` with an admin-visible reason, never silently answered from. Any other format is
// left uncached — no row, so it never grounds.

export interface KnowledgeSyncService {
  // Reconcile the cache against Drive once. Concurrent calls share the one in-flight pass and
  // resolve together; each sequential call is a fresh, idempotent pass.
  reconcile(): Promise<void>
}

export interface KnowledgeSyncOptions {
  // Report a best-effort failure ingesting one document during the first full load (ADR-0021): the
  // load logs it and moves on, so one corrupt or unreadable file never blocks the rest of the
  // corpus. Defaults to a no-op; the running server passes a logger and a test passes a collector.
  // (Contrast: a scanned PDF is a skipped row, not an error, and never reaches here.)
  onDocumentError?: (driveFileId: string, error: unknown) => void
}

export function createKnowledgeSyncService(
  repo: KnowledgeRepository,
  drive: DriveClient,
  clock: Clock,
  options: KnowledgeSyncOptions = {},
): KnowledgeSyncService {
  const reportDocumentError = options.onDocumentError ?? (() => {})
  // The single-flight latch: the promise of the pass currently running, or null when idle.
  // Assigned synchronously at the top of reconcile() before any await, so callers arriving in
  // the same tick as the first all observe it and coalesce onto the one pass.
  let inFlight: Promise<void> | null = null

  // Extract a live file's content by format, or null for a format that is not ingested at all
  // (left uncached, so it never grounds). A Google Doc is exported to text; a PDF, DOCX, XLSX,
  // or HTML page is downloaded and extracted, which also decides the scanned/image-only
  // skip-and-flag.
  const extractFile = async (file: DriveFileMetadata): Promise<ExtractionOutcome | null> => {
    switch (file.mimeType) {
      case GOOGLE_DOC_MIME_TYPE:
        return ingestAuthoredText(await drive.exportDoc(file.id))
      case PDF_MIME_TYPE:
        return extractPdf(await drive.downloadFile(file.id))
      case DOCX_MIME_TYPE:
        return extractDocx(await drive.downloadFile(file.id))
      case XLSX_MIME_TYPE:
        return extractXlsx(await drive.downloadFile(file.id))
      case HTML_MIME_TYPE:
        return extractHtml(await drive.downloadFile(file.id))
      default:
        return null
    }
  }

  // Ingest one live file into the cache: a supported format is upserted as ingested (with its
  // extracted text) or skipped (with an admin-visible reason); an unsupported format is left
  // uncached, so it never grounds an answer. Shared by the incremental change path and the full
  // load, so a file is ingested identically whichever branch reaches it.
  const ingestFile = async (file: DriveFileMetadata, now: Date): Promise<void> => {
    const outcome = await extractFile(file)
    if (outcome === null) {
      return
    }

    await repo.upsertDoc({
      driveFileId: file.id,
      title: file.name,
      content: outcome.content,
      skipReason: outcome.skipReason,
      sourceMimeType: file.mimeType,
      // Every doc is chain-wide in v1 (ADR-0014); per-location tagging is an additive change.
      locationId: null,
      status: outcome.status,
      driveModifiedTime: new Date(file.modifiedTime),
      now,
    })
  }

  // Apply one change to the cache. A removed or trashed file is deleted (the real adapter also
  // forwards a moved-out or out-of-folder file as a removal, ADR-0021); any other file is ingested.
  const applyChange = async (change: DriveChange, now: Date): Promise<void> => {
    if (change.removed || change.file?.trashed || !change.file) {
      await repo.deleteDocByDriveFileId(change.fileId)
      return
    }
    await ingestFile(change.file, now)
  }

  // The full load, run once when the knowledge base has never synced (ADR-0021): fill an
  // already-populated folder that the changes feed will never report, because those docs predate
  // any cursor. The order matters and is the correctness of this branch.
  const runFullLoad = async (): Promise<void> => {
    // 1. Capture the cursor at the current end of the feed BEFORE listing, so an edit made to a
    //    document while the load runs is caught by the next incremental reconcile rather than lost
    //    in the gap between the listing and a later-captured cursor.
    const startToken = await drive.getStartPageToken()

    // 2. Ingest every document currently in the folder, best-effort per document: a genuine error
    //    on one file (a download failure, an extraction throw) is reported and skipped so the rest
    //    of the corpus still becomes available. A scanned/image-only PDF is not an error — it
    //    ingests as a skipped row through the same path an incremental change would.
    const files = await drive.listFiles()
    for (const file of files) {
      try {
        await ingestFile(file, clock.now())
      } catch (error) {
        reportDocumentError(file.id, error)
      }
    }

    // 3. Persist the cursor last, only once the load has completed. A crashed or failed full load
    //    never writes it, so the next reconcile retries the full load from scratch — safe because
    //    upserts are idempotent. From here the knowledge base is "synced" and every later
    //    reconcile takes the incremental branch.
    await repo.setSyncCursor(startToken, clock.now())
  }

  // The incremental reconcile: drain every page from the persisted cursor, applying changes in feed
  // order (last write wins for a file that changed more than once). Fail-whole-pass — any error
  // aborts without advancing the cursor, so the next pass retries from the last durable cursor. The
  // cursor advances only to the durable newStartPageToken on the final page: a crash mid-drain
  // replays from the old cursor, safe because upsert/delete are idempotent.
  const runIncremental = async (startPageToken: string): Promise<void> => {
    let pageToken = startPageToken
    while (true) {
      const page = await drive.listChanges(pageToken)
      for (const change of page.changes) {
        await applyChange(change, clock.now())
      }
      if (page.newStartPageToken !== undefined) {
        await repo.setSyncCursor(page.newStartPageToken, clock.now())
        return
      }
      if (page.nextPageToken === undefined) {
        // A well-formed feed always ends a page with exactly one of the two tokens; guard the
        // contract so a malformed page fails loudly rather than looping forever.
        throw new Error('drive changes page had neither nextPageToken nor newStartPageToken')
      }
      pageToken = page.nextPageToken
    }
  }

  const runReconcile = async (): Promise<void> => {
    // "Has the knowledge base ever synced?" is "does a cursor exist?", not "are there zero ingested
    // docs" — a folder of only skipped (scanned) documents would look empty forever and full-load
    // on every tick otherwise (ADR-0021).
    const cursor = await repo.getSyncCursor()
    if (cursor === undefined) {
      await runFullLoad()
      return
    }
    await runIncremental(cursor)
  }

  return {
    reconcile: () => {
      // Coalesce onto the in-flight pass if one is running; otherwise start one and clear the
      // latch when it settles (success or failure), so the next call starts a fresh pass.
      if (inFlight) {
        return inFlight
      }
      inFlight = runReconcile().finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
