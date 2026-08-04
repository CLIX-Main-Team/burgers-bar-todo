import { JWT } from 'google-auth-library'
import type {
  DriveChange,
  DriveChangesPage,
  DriveClient,
  DriveFileMetadata,
} from './drive-client.js'

// The real Google Drive adapter behind the DriveClient port (ADR-0021). It is deliberately thin —
// service-account auth plus REST calls, pagination, and folder filtering, with no business logic —
// the same posture createHttpLlmClient takes for the LLM provider: a fetch-backed implementation of
// a transport-agnostic port, not unit-tested against the live provider (it is verified once by a
// throwaway probe, then the probe is discarded). The sync logic in knowledge-sync.ts drives this
// through the port and never names Google; the fake is its test double.
//
// Two things live here and nowhere else:
//   - Auth: a service-account JWT client (google-auth-library) minted read-only, whose access token
//     is attached to every request. All calls are plain `fetch` against Drive's v3 REST API — no
//     vendor SDK for the data plane, matching the fetch precedent of createHttpLlmClient.
//   - Folder scoping: Drive's changes feed is account-wide ("shared with me"), not folder-scoped, so
//     the scoping is done HERE — listFiles queries the one folder server-side, and listChanges
//     forwards a change as an upsert only when the folder is a parent, mapping every removal, trash,
//     or move-out to a deletion. knowledge-sync.ts therefore never learns about parents (ADR-0021).

// Read-only is all the sync needs; a narrower scope than read-write means a leaked key cannot mutate
// the corpus.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'

// The file metadata fields every list/change request asks Drive for. `parents` is requested on
// changes so the adapter can decide folder membership, then stripped before the port's
// DriveFileMetadata is built — the port never carries parents.
const FILE_FIELDS = 'id, name, mimeType, modifiedTime, trashed'
const CHANGE_FILE_FIELDS = `${FILE_FIELDS}, parents`

// A page of the account-wide changes feed as Drive returns it, before folder scoping.
interface RawChangeFile extends DriveFileMetadata {
  parents?: string[]
}
interface RawChange {
  fileId: string
  removed?: boolean
  file?: RawChangeFile
}

// The service-account credentials the JWT client authenticates with. Structurally the parsed
// ServiceAccountKey env.ts produces, kept as its own type so this adapter never imports the env.
export interface GoogleServiceAccount {
  clientEmail: string
  privateKey: string
}

export interface GoogleDriveClientConfig {
  serviceAccount: GoogleServiceAccount
  // The corpus folder every read is scoped to. Only its direct children are ever seen — flat, no
  // subfolder recursion (ADR-0021).
  folderId: string
}

export function createGoogleDriveClient(config: GoogleDriveClientConfig): DriveClient {
  const auth = new JWT({
    email: config.serviceAccount.clientEmail,
    key: config.serviceAccount.privateKey,
    scopes: [DRIVE_SCOPE],
  })

  // One authenticated Drive request. Mints (and internally caches/refreshes) the access token via
  // the JWT client, attaches it, and fails loudly on any non-2xx — the sync's fail-whole-pass /
  // best-effort handling above decides what a failure means, so this only needs to surface it.
  const driveFetch = async (url: string): Promise<Response> => {
    const { token } = await auth.getAccessToken()
    if (!token) {
      throw new Error('drive: failed to obtain a service-account access token')
    }
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      // The URL carries only the file id and Drive endpoint — no corpus content — so it is safe to
      // name in the error; the status class explains what went wrong.
      throw new Error(`drive: GET ${url} responded ${res.status}`)
    }
    return res
  }

  const buildUrl = (path: string, params: Record<string, string>): string => {
    const url = new URL(`${DRIVE_API}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  // Strip Drive's raw metadata down to the port's DriveFileMetadata — dropping parents, and pinning
  // trashed to a boolean the port always carries.
  const toMetadata = (file: RawChangeFile): DriveFileMetadata => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    trashed: file.trashed ?? false,
  })

  // Map one account-wide change to a folder-scoped port change. A change is an upsert only for a
  // live file still parented in the corpus folder; a removed, trashed, moved-out, or out-of-folder
  // file is forwarded as a deletion (the repository delete-by-drive-file-id is an idempotent no-op
  // for ids it never cached, so forwarding an out-of-folder deletion can never corrupt the cache).
  const scopeChange = (change: RawChange): DriveChange => {
    const file = change.file
    if (change.removed || !file) {
      return { fileId: change.fileId, removed: true }
    }
    const inFolder = file.parents?.includes(config.folderId) ?? false
    if (!inFolder || file.trashed) {
      return { fileId: change.fileId, removed: true }
    }
    return { fileId: change.fileId, removed: false, file: toMetadata(file) }
  }

  return {
    listFiles: async () => {
      // Drain the folder's direct children, scoped server-side to the one folder and to untrashed
      // files. Flat only — a document in a subfolder is simply not listed (ADR-0021).
      const files: DriveFileMetadata[] = []
      let pageToken: string | undefined
      do {
        const params: Record<string, string> = {
          q: `'${config.folderId}' in parents and trashed = false`,
          fields: `nextPageToken, files(${FILE_FIELDS})`,
          pageSize: '1000',
        }
        if (pageToken) {
          params.pageToken = pageToken
        }
        const res = await driveFetch(buildUrl('/files', params))
        const page = (await res.json()) as { files?: RawChangeFile[]; nextPageToken?: string }
        for (const file of page.files ?? []) {
          files.push(toMetadata(file))
        }
        pageToken = page.nextPageToken
      } while (pageToken)
      return files
    },

    getStartPageToken: async () => {
      const res = await driveFetch(buildUrl('/changes/startPageToken', {}))
      const body = (await res.json()) as { startPageToken?: string }
      if (!body.startPageToken) {
        throw new Error('drive: changes/startPageToken returned no token')
      }
      return body.startPageToken
    },

    listChanges: async (pageToken): Promise<DriveChangesPage> => {
      // One page of the account-wide feed, each change scoped to the corpus folder before it leaves
      // the adapter. includeRemoved surfaces deletions; restrictToMyDrive stays off because the
      // corpus is a shared-with-me folder, not My Drive.
      const res = await driveFetch(
        buildUrl('/changes', {
          pageToken,
          includeRemoved: 'true',
          fields: `newStartPageToken, nextPageToken, changes(fileId, removed, file(${CHANGE_FILE_FIELDS}))`,
        }),
      )
      const body = (await res.json()) as {
        changes?: RawChange[]
        nextPageToken?: string
        newStartPageToken?: string
      }
      const changes = (body.changes ?? []).map(scopeChange)
      if (body.newStartPageToken !== undefined) {
        return { changes, newStartPageToken: body.newStartPageToken }
      }
      return { changes, nextPageToken: body.nextPageToken }
    },

    exportDoc: async (fileId) => {
      // A Google Doc exported to plain text (files.export text/plain) — the Doc path the sync feeds
      // straight to ingestion.
      const res = await driveFetch(buildUrl(`/files/${fileId}/export`, { mimeType: 'text/plain' }))
      return res.text()
    },

    downloadFile: async (fileId) => {
      // A non-Doc file's raw bytes (files.get alt=media) — the PDF/DOCX path the extractor reads.
      const res = await driveFetch(buildUrl(`/files/${fileId}`, { alt: 'media' }))
      return Buffer.from(await res.arrayBuffer())
    },
  }
}
