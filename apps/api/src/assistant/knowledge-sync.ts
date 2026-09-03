import type { Clock } from '../auth/clock.js'
import {
  DOCX_MIME_TYPE,
  type ExtractionOutcome,
  HTML_MIME_TYPE,
  PDF_MIME_TYPE,
  PPTX_MIME_TYPE,
  XLSX_MIME_TYPE,
  extractDocx,
  extractHtml,
  extractPdf,
  extractPptx,
  extractXlsx,
  ingestAuthoredText,
} from './document-extraction.js'
import { classifyDocument } from './document-metadata.js'
import {
  type DriveChange,
  type DriveClient,
  type DriveFileMetadata,
  DriveHttpError,
  GOOGLE_DOC_MIME_TYPE,
} from './drive-client.js'
import type { KnowledgeRepository } from './repository.js'
import type { VisualTranscriber } from './visual-transcriber.js'

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
  // Runs after every completed pass, inside the single-flight latch — the seam the knowledge
  // categorizer hangs off (ADR-0024), kept as a plain hook so the sync never learns about the
  // LLM. Its failure is reported and swallowed: filing is a Knowledge-tab nicety, and a broken
  // categorizer must never fail a reconcile the assistant's grounding depends on.
  afterReconcile?: () => Promise<void>
  // The visual transcriber (2026-09 plan, phase 2): a diagram-flagged DOCX/deck gets one chance
  // to become real text before its skip is persisted. Absent (a transcriber-less boot, most
  // tests), phase-1 behaviour stands unchanged — the flag is the outcome.
  transcriber?: VisualTranscriber
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

  // Fetch a live file's bytes (or a Google Doc's exported text), or null for a format that is not
  // ingested at all (left uncached, so it never grounds). This half is I/O, so a failure here is
  // transient by nature — a network blip, an expired token, Drive being unavailable — and must
  // propagate so the pass aborts without advancing the cursor and the file is retried.
  const fetchFile = async (
    file: DriveFileMetadata,
  ): Promise<{ text: string } | { bytes: Buffer } | null> => {
    switch (file.mimeType) {
      case GOOGLE_DOC_MIME_TYPE:
        return { text: await drive.exportDoc(file.id) }
      case PDF_MIME_TYPE:
      case DOCX_MIME_TYPE:
      case XLSX_MIME_TYPE:
      case HTML_MIME_TYPE:
      case PPTX_MIME_TYPE:
        return { bytes: await drive.downloadFile(file.id) }
      default:
        return null
    }
  }

  // Turn fetched bytes into an extraction outcome. This half is pure computation over bytes already
  // in hand, so a failure here is DETERMINISTIC: the same file will fail the same way on every
  // future pass. That distinction is the whole point of the split — see ingestFile.
  const extractFetched = async (
    file: DriveFileMetadata,
    payload: { text: string } | { bytes: Buffer },
  ): Promise<ExtractionOutcome> => {
    if ('text' in payload) {
      return ingestAuthoredText(payload.text)
    }
    switch (file.mimeType) {
      case PDF_MIME_TYPE:
        return extractPdf(payload.bytes)
      case DOCX_MIME_TYPE:
        return extractDocx(payload.bytes)
      case XLSX_MIME_TYPE:
        return extractXlsx(payload.bytes)
      case PPTX_MIME_TYPE:
        return extractPptx(payload.bytes)
      default:
        return extractHtml(payload.bytes)
    }
  }

  // The admin-visible reason recorded for a file whose bytes arrived but could not be parsed — an
  // encrypted or corrupt PDF, a DOCX that is not a zip, a workbook with no sheets. The error's own
  // message is included because it is produced by the parser over the file's own bytes and names
  // the format problem, never the document's content.
  const unreadableReason = (error: unknown): string =>
    `could not be read: ${error instanceof Error ? error.message : String(error)}`

  // Ingest one live file into the cache: a supported format is upserted as ingested (with its
  // extracted text) or skipped (with an admin-visible reason); an unsupported format is left
  // uncached, so it never grounds an answer. Shared by the incremental change path and the full
  // load, so a file is ingested identically whichever branch reaches it.
  //
  // A parse failure becomes a skipped row rather than a thrown error. Before this, one encrypted
  // PDF dropped into the corpus folder threw on every incremental pass forever: the cursor never
  // advanced, so the same change replayed every twenty minutes, /assistant/resync 500'd, and the
  // whole knowledge base silently stopped updating chain-wide with only a console line to say so.
  // The full load already contained each file's failure; the incremental branch did not, and that
  // inconsistency was the bug. Blanket catch-and-continue would be the wrong fix in the other
  // direction — it would swallow a transient download failure and lose that change forever — which
  // is why only the deterministic half is caught, and the file lands in the same skipped-with-a-
  // reason state an unreadable scanned PDF already used, visible in the Knowledge tab.
  const ingestFile = async (file: DriveFileMetadata, now: Date): Promise<void> => {
    const payload = await fetchFile(file)
    if (payload === null) {
      return
    }
    let outcome: ExtractionOutcome
    try {
      outcome = await extractFetched(file, payload)
    } catch (error) {
      reportDocumentError(file.id, error)
      outcome = { status: 'skipped', content: null, skipReason: unreadableReason(error) }
    }

    // A diagram-flagged document gets one shot at visual transcription (2026-09 plan, phase 2)
    // before its skip is persisted: a faithful transcription ingests as the document's content
    // through the same capped path authored text takes; anything less keeps the phase-1 flag —
    // never a guessed hierarchy. Failures are reported (an admin-visible flagged row plus a log
    // line), and a throw is contained here for the same reason extraction failures are: one bad
    // document must never stall the cursor. A success stamps the row's transcribed_at — the
    // machine-provenance tag the content itself no longer carries.
    let transcribed = false
    if (
      outcome.status === 'skipped' &&
      outcome.skipKind === 'diagram' &&
      options.transcriber &&
      'bytes' in payload
    ) {
      try {
        const transcription = await options.transcriber.transcribe({
          title: file.name,
          mimeType: file.mimeType,
          bytes: payload.bytes,
        })
        if (transcription.ok) {
          outcome = ingestAuthoredText(transcription.content)
          transcribed = true
        } else {
          reportDocumentError(file.id, new Error(`visual transcription: ${transcription.reason}`))
        }
      } catch (error) {
        reportDocumentError(file.id, error)
      }
    }

    // Recomputed on every ingest rather than stored once, so a document that is renamed or moved
    // into another folder is reclassified by the same pass that notices the change. It is a pure
    // function of the file's own metadata, so this costs nothing and can never disagree with itself.
    const classification = classifyDocument({
      title: file.name,
      folderName: file.folderName,
      sourceMimeType: file.mimeType,
    })

    await repo.upsertDoc({
      driveFileId: file.id,
      title: file.name,
      content: outcome.content,
      skipReason: outcome.skipReason,
      sourceMimeType: file.mimeType,
      // Every doc is chain-wide in v1 (ADR-0014); per-location tagging is an additive change.
      locationId: null,
      status: outcome.status,
      // The Drive folder, carried through to the cache rather than consumed and dropped: the
      // Knowledge tab groups by it, and the classifier below reads the same value, so the tab and
      // the access rules can never disagree about where a document lives. Trimmed because Drive
      // keeps whatever whitespace the folder was named with, and "מחלקת תפעול " and "מחלקת תפעול"
      // are one folder to a person and two shelves to a Map.
      folderName: file.folderName?.trim() || null,
      department: classification.department,
      docType: classification.docType,
      sensitivity: classification.sensitivity,
      driveModifiedTime: new Date(file.modifiedTime),
      transcribed,
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

    // 2b. Drop every cached doc the folder no longer holds. A full load used to only ever ADD, so a
    //     document deleted from Drive while no cursor existed kept answering questions from the
    //     cache — which is what happened in 2026-08, when two withdrawn SOPs went on being cited
    //     and had to be deleted from the database by hand. It matters most on exactly this path:
    //     clearing the cursor is the recovery for an expired page token below, and without a purge
    //     that recovery would resurrect every document deleted since the cursor was lost. With
    //     lease and HR material in the corpus, that is an exposure question, not a staleness one.
    //     Skipped only when the listing came back empty, because "the folder is empty" and "the
    //     listing silently returned nothing" look identical here and the blast radius is the
    //     entire corpus; a genuinely emptied folder is then one hand-run resync away.
    if (files.length > 0) {
      const removed = await repo.deleteDocsNotIn(files.map((file) => file.id))
      if (removed > 0) {
        reportDocumentError(
          'full-load-purge',
          new Error(`removed ${removed} cached doc(s) no longer present in Drive`),
        )
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
    } else {
      try {
        await runIncremental(cursor)
      } catch (error) {
        // An expired page token (Drive answers 410) is permanent: the cursor can never be resumed,
        // so every later pass replays the same token, throws the same error, and the corpus stops
        // updating with nothing but a console line to show for it. Weeks of downtime produce this,
        // which is precisely what a billing suspension is, and the only recovery until now was
        // deleting the cursor row by hand. Falling back to a full load re-derives a fresh token
        // from the current state of the folder, and is safe to do automatically because the load
        // now purges absentees rather than resurrecting them. Every other failure still aborts the
        // pass with the cursor untouched, so the next tick simply retries.
        if (!(error instanceof DriveHttpError) || error.status !== 410) {
          throw error
        }
        reportDocumentError(
          'sync-cursor',
          new Error('drive page token expired; falling back to a full load'),
        )
        await runFullLoad()
      }
    }
    if (options.afterReconcile) {
      try {
        await options.afterReconcile()
      } catch (error) {
        reportDocumentError('afterReconcile', error)
      }
    }
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
