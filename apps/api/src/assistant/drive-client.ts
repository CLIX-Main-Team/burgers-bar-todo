// The Drive-client port (ADR-0004, ADR-0014, assistant plan drive seam): the whole surface
// reconciliation touches on Google Drive, behind one transport-agnostic interface so the
// sync never names googleapis and tests substitute a fake. It mirrors how the auth module
// injects the clock and mailer — one port, one real implementation (deferred to the real-
// Drive wiring behind provisioning), one capturing/scriptable fake below as the test double.
//
// The three operations are the ones reconciliation needs: walk the account's changes feed
// from a page token, export a Google Doc to plain text, and download a non-Doc file's bytes.
// downloadFile feeds the multi-format ingestion (#88): a text-layer PDF and a DOCX are
// downloaded and extracted (document-extraction.ts), a Google Doc still goes through exportDoc.

// The Google Drive mime type for a Google Doc — exported to text rather than downloaded.
export const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'

// A file's Drive metadata as the changes feed reports it. modifiedTime is Drive's RFC3339
// timestamp for the revision; trashed marks a file still in the account but moved to the
// trash, which reconciliation treats as a removal.
export interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  trashed: boolean
}

// One entry in the changes feed. `removed` is true when the file left the account's scope
// entirely (deleted, or unshared); otherwise `file` carries its current metadata. A trashed
// file arrives as a non-removed change whose metadata has trashed = true.
export interface DriveChange {
  fileId: string
  removed: boolean
  file?: DriveFileMetadata
}

// One page of the changes feed. Exactly one of the two tokens is present: nextPageToken
// while more pages remain this sync, or newStartPageToken on the final page — the durable
// cursor to persist and resume the next sync from.
export interface DriveChangesPage {
  changes: DriveChange[]
  nextPageToken?: string
  newStartPageToken?: string
}

export interface DriveClient {
  // The folder's current documents — every file living directly in the corpus folder right now,
  // trashed ones excluded, draining Drive's pagination internally (ADR-0021). This is the one
  // capability the boot-time full load needs: on a never-synced knowledge base the reconcile
  // lists the already-populated folder and ingests each file, rather than waiting for the
  // changes feed to report edits it will never make for docs that predate the cursor. The real
  // adapter scopes this server-side to the one folder; the sync never learns about parents.
  listFiles(): Promise<DriveFileMetadata[]>
  // A page token marking the current end of the changes feed, obtained once when there is
  // no persisted cursor. Only changes recorded at or after it are ever seen — the corpus is
  // seeded by authoring into the folder after the cursor exists (provisioning, ADR-0014).
  getStartPageToken(): Promise<string>
  // The changes recorded from `pageToken` onward, one page at a time. Callers drain pages
  // via nextPageToken until newStartPageToken appears.
  listChanges(pageToken: string): Promise<DriveChangesPage>
  // Export a Google Doc to plain text (`files.export` text/plain).
  exportDoc(fileId: string): Promise<string>
  // Download a non-Doc file's raw bytes (`files.get` alt=media); used by the format-widening
  // ticket, declared here so that ticket extends this port rather than changing it.
  downloadFile(fileId: string): Promise<Buffer>
}

// A scriptable fake Drive — the test double the plan names, living in src/ beside the port
// (as the auth mailer/clock fakes do) so the sync service and its tests share one definition.
// It models the one thing reconciliation depends on: an append-only changes feed over a set
// of files. A test mutates the folder through putDoc/removeFile, which append change entries
// exactly as an author editing Drive would produce them; the port methods replay those
// entries from a page token. Page tokens are offsets into the log, so getStartPageToken
// returns the current end and only later changes are seen — faithfully reproducing Drive's
// "future changes only" cursor, which is why a test seeds the cursor with one sync before
// authoring the docs it then observes. listFiles reads the live file set directly (trashed
// excluded), modelling the folder's current contents the first full load ingests (ADR-0021).
export interface FakeDriveFile {
  name: string
  mimeType: string
  // The Doc-export text, for a Google Doc read via exportDoc. Optional so a downloaded binary
  // format (a PDF or DOCX supplied through `bytes`) need not carry a meaningless text field.
  content?: string
  // The raw file bytes, for a non-Doc format read via downloadFile — e.g. a real PDF or DOCX
  // fixture. When absent, downloadFile falls back to the utf-8 bytes of `content`.
  bytes?: Buffer
  modifiedTime: string
  trashed?: boolean
}

// The call counts a test reads to prove single-flight and to tell the full-load branch from the
// incremental one: how many times the folder was listed vs. the feed walked. A crowd of coalesced
// reconcile() calls must not multiply these, and a second reconcile after a full load must walk
// the feed (listChanges) rather than list the folder again (listFiles).
export interface FakeDriveCalls {
  listFiles: number
  getStartPageToken: number
  listChanges: number
  exportDoc: number
  downloadFile: number
}

export interface FakeDriveClient extends DriveClient {
  // Add or edit a file in the folder, appending a change the next sync will see. Called
  // with the same id twice models an edit; the second call's content/modifiedTime win.
  putDoc(fileId: string, file: FakeDriveFile): void
  // Remove a file from the folder, appending a `removed` change.
  removeFile(fileId: string): void
  // How many pages listChanges returns at most per call; small values force multi-page
  // drains so the pagination loop is exercised. Defaults to a single page.
  setPageSize(size: number): void
  // Make the next listChanges reject, modelling an unavailable Drive — the failure the boot
  // fire-and-forget sync (ADR-0021) must isolate so a broken Drive never fails a deploy. One-shot:
  // the following walk succeeds again.
  failNextListChanges(message?: string): void
  // Make the next listFiles reject, modelling a Drive outage during the first full load (ADR-0021):
  // the load aborts before persisting the cursor, so the next reconcile retries the full load.
  // One-shot: the following list succeeds again.
  failNextListFiles(message?: string): void
  // Make exportDoc/downloadFile throw for one file, modelling a genuine per-document ingestion
  // error (a download failure or an extraction throw) during a full load. The load is best-effort
  // per document, so that one file is logged and skipped while the rest still ingest.
  failReadOf(fileId: string, message?: string): void
  // Hold the next listChanges open until the returned release is called, modelling a slow Drive.
  // The login trigger returns without awaiting it, so sign-in must complete before release; the
  // test releases and then drains the coalesced sync before teardown.
  holdNextListChanges(): () => void
  readonly calls: FakeDriveCalls
  reset(): void
}

interface ChangeEntry {
  fileId: string
  removed: boolean
  file?: DriveFileMetadata
}

export function createFakeDriveClient(): FakeDriveClient {
  // The append-only changes log; a page token is the string of an index into it.
  let log: ChangeEntry[] = []
  // The current content of each live file, so exportDoc/downloadFile return the latest.
  let files = new Map<string, FakeDriveFile>()
  let pageSize = Number.POSITIVE_INFINITY
  // One-shot Drive-unreliability controls for the sync-trigger cases (#89): a pending error the
  // next listChanges throws, and a gate the next listChanges awaits before proceeding.
  let nextListChangesError: string | null = null
  let nextListChangesGate: Promise<void> | null = null
  // Full-load unreliability controls (ADR-0021): a one-shot error the next listFiles throws, and a
  // per-file read error the export/download paths throw so a single document fails best-effort.
  let nextListFilesError: string | null = null
  const readErrors = new Map<string, string>()
  const calls: FakeDriveCalls = {
    listFiles: 0,
    getStartPageToken: 0,
    listChanges: 0,
    exportDoc: 0,
    downloadFile: 0,
  }

  const metadataOf = (fileId: string, file: FakeDriveFile): DriveFileMetadata => ({
    id: fileId,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    trashed: file.trashed ?? false,
  })

  return {
    putDoc: (fileId, file) => {
      files.set(fileId, file)
      log.push({ fileId, removed: false, file: metadataOf(fileId, file) })
    },

    removeFile: (fileId) => {
      files.delete(fileId)
      log.push({ fileId, removed: true })
    },

    setPageSize: (size) => {
      pageSize = size
    },

    failNextListChanges: (message = 'fake drive: listChanges unavailable') => {
      nextListChangesError = message
    },

    failNextListFiles: (message = 'fake drive: listFiles unavailable') => {
      nextListFilesError = message
    },

    failReadOf: (fileId, message = `fake drive: cannot read file ${fileId}`) => {
      readErrors.set(fileId, message)
    },

    holdNextListChanges: () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      nextListChangesGate = gate
      return release
    },

    get calls() {
      return calls
    },

    reset: () => {
      log = []
      files = new Map()
      pageSize = Number.POSITIVE_INFINITY
      nextListChangesError = null
      nextListChangesGate = null
      nextListFilesError = null
      readErrors.clear()
      calls.listFiles = 0
      calls.getStartPageToken = 0
      calls.listChanges = 0
      calls.exportDoc = 0
      calls.downloadFile = 0
    },

    listFiles: async () => {
      calls.listFiles += 1
      if (nextListFilesError) {
        const message = nextListFilesError
        nextListFilesError = null
        throw new Error(message)
      }
      // The folder's current contents as the real adapter's server-side scoping would return them:
      // live files only, trashed ones excluded. The sync ingests exactly these on a full load.
      return [...files.entries()]
        .filter(([, file]) => !(file.trashed ?? false))
        .map(([fileId, file]) => metadataOf(fileId, file))
    },

    getStartPageToken: async () => {
      calls.getStartPageToken += 1
      return String(log.length)
    },

    listChanges: async (pageToken) => {
      calls.listChanges += 1
      // Honour the one-shot unreliability controls (#89): hold on the gate if one is set, then
      // reject if a failure is queued — both consumed so the following walk behaves normally.
      const gate = nextListChangesGate
      if (gate) {
        nextListChangesGate = null
        await gate
      }
      if (nextListChangesError) {
        const message = nextListChangesError
        nextListChangesError = null
        throw new Error(message)
      }
      const start = Number(pageToken)
      const end = Math.min(log.length, start + pageSize)
      const changes = log.slice(start, end).map((entry) => ({ ...entry }))
      if (end < log.length) {
        return { changes, nextPageToken: String(end) }
      }
      return { changes, newStartPageToken: String(log.length) }
    },

    exportDoc: async (fileId) => {
      calls.exportDoc += 1
      const readError = readErrors.get(fileId)
      if (readError) {
        throw new Error(readError)
      }
      const file = files.get(fileId)
      if (!file) {
        throw new Error(`fake drive: exportDoc for unknown file ${fileId}`)
      }
      return file.content ?? ''
    },

    downloadFile: async (fileId) => {
      calls.downloadFile += 1
      const readError = readErrors.get(fileId)
      if (readError) {
        throw new Error(readError)
      }
      const file = files.get(fileId)
      if (!file) {
        throw new Error(`fake drive: downloadFile for unknown file ${fileId}`)
      }
      return file.bytes ?? Buffer.from(file.content ?? '')
    },
  }
}
