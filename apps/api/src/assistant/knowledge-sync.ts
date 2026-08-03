import type { Clock } from '../auth/clock.js'
import { type DriveChange, type DriveClient, GOOGLE_DOC_MIME_TYPE } from './drive-client.js'
import type { KnowledgeRepository } from './repository.js'

// The one idempotent reconciliation pass that keeps the knowledge cache consistent with the
// Drive corpus (ADR-0004, ADR-0014). It obtains a start page token when there is no cursor,
// walks `changes.list` from the persisted cursor, upserts or deletes each cache row keyed on
// drive_file_id, and advances the cursor — so calling it repeatedly converges the cache and
// is safe. It is single-flight: a crowd of concurrent callers (a shift-open login rush, the
// backstop poll, a manual resync) collapses onto one sync in flight, so Drive is walked once.
//
// Google Docs are the one ingested format in this slice (`files.export` to text/plain). Other
// formats — text PDFs, DOCX, the scanned-and-skipped case — are the next ticket, which extends
// the ingest branch below rather than re-scaffolding this pass.

export interface KnowledgeSyncService {
  // Reconcile the cache against Drive once. Concurrent calls share the one in-flight pass and
  // resolve together; each sequential call is a fresh, idempotent pass.
  reconcile(): Promise<void>
}

export function createKnowledgeSyncService(
  repo: KnowledgeRepository,
  drive: DriveClient,
  clock: Clock,
): KnowledgeSyncService {
  // The single-flight latch: the promise of the pass currently running, or null when idle.
  // Assigned synchronously at the top of reconcile() before any await, so callers arriving in
  // the same tick as the first all observe it and coalesce onto the one pass.
  let inFlight: Promise<void> | null = null

  // Apply one change to the cache. A removed or trashed file is deleted; a Google Doc is
  // exported and upserted as ingested; any other live format is left for the format-widening
  // ticket (no row, so it never grounds an answer until it can actually be read).
  const applyChange = async (change: DriveChange, now: Date): Promise<void> => {
    if (change.removed || change.file?.trashed || !change.file) {
      await repo.deleteDocByDriveFileId(change.fileId)
      return
    }

    const file = change.file
    if (file.mimeType !== GOOGLE_DOC_MIME_TYPE) {
      return
    }

    const content = await drive.exportDoc(file.id)
    await repo.upsertDoc({
      driveFileId: file.id,
      title: file.name,
      content,
      sourceMimeType: file.mimeType,
      // Every doc is chain-wide in v1 (ADR-0014); per-location tagging is an additive change.
      locationId: null,
      status: 'ingested',
      driveModifiedTime: new Date(file.modifiedTime),
      now,
    })
  }

  const runReconcile = async (): Promise<void> => {
    // Seed the cursor on the first sync: with no persisted token, obtain and store the current
    // start page token, then walk from it. A doc authored before this first sync is not in the
    // feed from here (Drive reports only changes at or after the token); the corpus is authored
    // after provisioning seeds the cursor (ADR-0014).
    let pageToken = await repo.getSyncCursor()
    if (pageToken === undefined) {
      pageToken = await drive.getStartPageToken()
      await repo.setSyncCursor(pageToken, clock.now())
    }

    // Drain every page from the cursor, applying changes in feed order (last write wins for a
    // file that changed more than once). The cursor advances only to the durable
    // newStartPageToken on the final page: a crash mid-drain replays from the old cursor, which
    // is safe because upsert/delete are idempotent.
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
