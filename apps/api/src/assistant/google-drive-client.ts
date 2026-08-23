import { JWT } from 'google-auth-library'
import {
  type DriveChange,
  type DriveChangesPage,
  type DriveClient,
  type DriveFileMetadata,
  DriveHttpError,
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
//     the scoping is done HERE — listFiles walks the corpus folder tree (any depth, ADR-0023), and
//     listChanges forwards a change as an upsert only when a corpus folder is a parent, mapping
//     every removal, trash, or move-out to a deletion and fanning a folder-level change out to the
//     files it silently carries. knowledge-sync.ts therefore never learns about parents (ADR-0021).

// Read-only is all the sync needs; a narrower scope than read-write means a leaked key cannot mutate
// the corpus.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'

// The file metadata fields every list/change request asks Drive for. `parents` is requested on
// changes so the adapter can decide folder membership, then stripped before the port's
// DriveFileMetadata is built — the port never carries parents.
const FILE_FIELDS = 'id, name, mimeType, modifiedTime, trashed'
const CHANGE_FILE_FIELDS = `${FILE_FIELDS}, parents`

// The Drive mime type marking a folder — the branch nodes of the corpus tree walk (ADR-0023).
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

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
  // The corpus folder every read is scoped to — the root of the folder tree the adapter walks;
  // documents at any depth under it are seen (ADR-0023).
  folderId: string
  // The pause before a retried request, overridable so tests retry instantly. Production keeps
  // the default.
  retryDelayMs?: number
}

// How many times one Drive request may run before its failure is the pass's failure. A folder
// walk is two sequential requests per folder, so at a deep client-shaped tree a single transient
// 500 or dropped connection anywhere in the walk used to kill the entire sync pass — and the
// 20-minute cadence made that a visible corpus freeze, not a blip. Two retries with a short
// growing pause absorb the transient class; a genuine outage still fails fast enough for the
// resync route's caller (holding an open HTTP request) not to time out.
const DRIVE_FETCH_ATTEMPTS = 3
const DRIVE_RETRY_DELAY_MS = 500

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Transient at the HTTP level: rate limiting and server-side errors. Anything else non-2xx
// (403 scope problems, 404 vanished files, 410 expired cursors) is semantic — retrying cannot
// change it, and the sync's own handling decides what it means.
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

export function createGoogleDriveClient(config: GoogleDriveClientConfig): DriveClient {
  const auth = new JWT({
    email: config.serviceAccount.clientEmail,
    key: config.serviceAccount.privateKey,
    scopes: [DRIVE_SCOPE],
  })

  const retryDelayMs = config.retryDelayMs ?? DRIVE_RETRY_DELAY_MS

  // One authenticated Drive request. Mints (and internally caches/refreshes) the access token via
  // the JWT client, attaches it, retries the transient failure class (network drop, 429, 5xx)
  // with a growing pause, and fails loudly on anything else — the sync's fail-whole-pass /
  // best-effort handling above decides what a failure means, so this only needs to surface it.
  const driveFetch = async (url: string): Promise<Response> => {
    const { token } = await auth.getAccessToken()
    if (!token) {
      throw new Error('drive: failed to obtain a service-account access token')
    }
    for (let attempt = 1; ; attempt += 1) {
      const lastAttempt = attempt === DRIVE_FETCH_ATTEMPTS
      let res: Response
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      } catch (error) {
        // fetch itself rejected: the connection-level transient class.
        if (lastAttempt) {
          throw error
        }
        await sleep(retryDelayMs * attempt)
        continue
      }
      if (res.ok) {
        return res
      }
      if (isRetryableStatus(res.status) && !lastAttempt) {
        await sleep(retryDelayMs * attempt)
        continue
      }
      // The URL carries only the file id and Drive endpoint — no corpus content — so it is safe to
      // name in the error; the status class explains what went wrong.
      throw new DriveHttpError(res.status, `drive: GET ${url} responded ${res.status}`)
    }
  }

  const buildUrl = (path: string, params: Record<string, string>): string => {
    const url = new URL(`${DRIVE_API}${path}`)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    return url.toString()
  }

  // Strip Drive's raw metadata down to the port's DriveFileMetadata — dropping parents (the raw
  // ids stay an adapter concern), pinning trashed to a boolean the port always carries, and
  // attaching the resolved section name the tree walk already knows.
  const toMetadata = (file: RawChangeFile, folderName: string | null): DriveFileMetadata => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedTime: file.modifiedTime,
    trashed: file.trashed ?? false,
    folderName,
  })

  // One folder's direct children (paginated), scoped server-side by the query clauses: folders
  // only or files only by mime, trashed excluded unless a cascade needs to see into a trashed
  // folder — a file inside one reports trashed = true itself (Drive v3 inherits the flag), so a
  // `trashed = false` query would hide exactly the files a folder-removal cascade must forward.
  const listChildren = async (
    folderId: string,
    opts: { kind: 'folders' | 'files'; includeTrashed?: boolean },
  ): Promise<RawChangeFile[]> => {
    const clauses = [
      `'${folderId}' in parents`,
      opts.kind === 'folders'
        ? `mimeType = '${FOLDER_MIME_TYPE}'`
        : `mimeType != '${FOLDER_MIME_TYPE}'`,
    ]
    if (!opts.includeTrashed) {
      clauses.push('trashed = false')
    }
    const children: RawChangeFile[] = []
    let pageToken: string | undefined
    do {
      const params: Record<string, string> = {
        q: clauses.join(' and '),
        fields: `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: '1000',
      }
      if (pageToken) {
        params.pageToken = pageToken
      }
      const res = await driveFetch(buildUrl('/files', params))
      const page = (await res.json()) as { files?: RawChangeFile[]; nextPageToken?: string }
      children.push(...(page.files ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return children
  }

  // Every folder in the tree under rootId, root included, mapped to its SECTION — the name of the
  // top-level folder under the corpus root that its branch begins with, or null for the root
  // itself. A section rather than the immediate parent, so a document filed three folders deep
  // still reports the department its branch starts with instead of "2026".
  //
  // Breadth-first, cycle-guarded (a shortcut cannot cycle, but the guard costs one Map lookup and
  // removes the failure mode). rootSection seeds the walk for a subtree listed on its own, so a
  // folder fanned out by the changes feed classifies its files exactly as a full load would.
  const listFolderTree = async (
    rootId: string,
    includeTrashed = false,
    rootSection: string | null = null,
  ): Promise<Map<string, string | null>> => {
    const folders = new Map<string, string | null>([[rootId, rootSection]])
    let frontier = [rootId]
    while (frontier.length > 0) {
      const next: string[] = []
      for (const folderId of frontier) {
        for (const child of await listChildren(folderId, { kind: 'folders', includeTrashed })) {
          if (!folders.has(child.id)) {
            folders.set(child.id, folders.get(folderId) ?? child.name)
            next.push(child.id)
          }
        }
      }
      frontier = next
    }
    return folders
  }

  // Every document under rootId at any depth, folders themselves excluded (they are containers,
  // never docs — the sync would leave them uncached anyway, so listing them buys nothing).
  const listFilesUnder = async (
    rootId: string,
    includeTrashed = false,
    rootSection: string | null = null,
  ): Promise<DriveFileMetadata[]> => {
    const files: DriveFileMetadata[] = []
    for (const [folderId, section] of await listFolderTree(rootId, includeTrashed, rootSection)) {
      for (const child of await listChildren(folderId, { kind: 'files', includeTrashed })) {
        files.push(toMetadata(child, section))
      }
    }
    return files
  }

  // Map one account-wide change to folder-scoped port changes. A file change is an upsert only
  // for a live file parented anywhere in the corpus folder tree (ADR-0023); a removed, trashed,
  // moved-out, or out-of-corpus file is forwarded as a deletion (the repository
  // delete-by-drive-file-id is an idempotent no-op for ids it never cached, so forwarding an
  // out-of-corpus deletion can never corrupt the cache).
  //
  // A folder change fans out: Drive reports ONLY the folder when it is dragged in, dragged out,
  // or trashed — the files it carries never produce change events of their own. So a folder
  // still in the tree expands to upserts for every document under it, and one that left the tree
  // expands to removals for every document it took with it. The folder id itself is forwarded as
  // a removal: a folder is never a cached doc, so this is at most an idempotent no-op.
  const scopeChange = async (
    change: RawChange,
    corpusFolders: Map<string, string | null>,
  ): Promise<DriveChange[]> => {
    const file = change.file
    if (change.removed || !file) {
      return [{ fileId: change.fileId, removed: true }]
    }
    if (file.mimeType === FOLDER_MIME_TYPE) {
      const inTree = corpusFolders.has(file.id) && !file.trashed
      // Seeded with the folder's own section so a fanned-out file lands in the same department a
      // full load would give it; a folder newly dragged in has no section yet and is its own.
      const contained = await listFilesUnder(
        file.id,
        !inTree,
        corpusFolders.get(file.id) ?? file.name,
      )
      const scoped: DriveChange[] = contained.map((doc) =>
        inTree ? { fileId: doc.id, removed: false, file: doc } : { fileId: doc.id, removed: true },
      )
      scoped.push({ fileId: file.id, removed: true })
      return scoped
    }
    const corpusParent = file.parents?.find((parent) => corpusFolders.has(parent))
    if (corpusParent === undefined || file.trashed) {
      return [{ fileId: change.fileId, removed: true }]
    }
    return [
      {
        fileId: change.fileId,
        removed: false,
        file: toMetadata(file, corpusFolders.get(corpusParent) ?? null),
      },
    ]
  }

  return {
    listFiles: async () => {
      // Every document in the corpus folder tree, any depth (ADR-0023 amends ADR-0021's flat-only
      // listing), untrashed only, draining Drive's pagination internally.
      return listFilesUnder(config.folderId)
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
      // One page of the account-wide feed, each change scoped to the corpus folder tree before it
      // leaves the adapter. includeRemoved surfaces deletions; restrictToMyDrive stays off because
      // the corpus is a shared-with-me folder, not My Drive.
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
      // The tree is walked at most once per page, and only when a change actually needs scoping —
      // the common quiet poll (zero changes every 20 minutes) costs no folder queries at all.
      // Rebuilt per page rather than cached across polls so a folder created moments before its
      // files' changes arrive is already known.
      let treePromise: Promise<Map<string, string | null>> | null = null
      const corpusFolders = () => {
        treePromise ??= listFolderTree(config.folderId)
        return treePromise
      }
      const changes: DriveChange[] = []
      for (const change of body.changes ?? []) {
        changes.push(...(await scopeChange(change, await corpusFolders())))
      }
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
