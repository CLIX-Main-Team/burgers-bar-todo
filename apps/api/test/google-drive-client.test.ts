import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleDriveClient } from '../src/assistant/google-drive-client.js'

// Unit coverage for the adapter's subfolder recursion (ADR-0023, amends ADR-0021's flat-only
// scoping): listCorpus walks the corpus folder tree and returns documents at any depth, and
// listChanges scopes each change against the folder tree instead of the root alone — including
// the two silent bulk moves only a folder-level change reports (a folder dragged into the corpus
// carries files that never produce their own change events; one dragged out or trashed takes its
// files with it equally silently). Fetch is mocked at the transport seam, the same posture as
// createHttpLlmClient's tests; the JWT client is stubbed so no test ever mints a real token.

vi.mock('google-auth-library', () => ({
  JWT: vi.fn(() => ({ getAccessToken: async () => ({ token: 'test-token' }) })),
}))

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DOC_MIME = 'application/vnd.google-apps.document'
const ROOT = 'corpus-root'

interface FakeNode {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  trashed?: boolean
  parent: string
}

interface RawChange {
  fileId: string
  removed?: boolean
  file?: {
    id: string
    name: string
    mimeType: string
    modifiedTime: string
    trashed?: boolean
    parents?: string[]
  }
}

const doc = (id: string, parent: string, overrides: Partial<FakeNode> = {}): FakeNode => ({
  id,
  name: `${id}.docx`,
  mimeType: DOC_MIME,
  modifiedTime: '2026-08-09T00:00:00Z',
  parent,
  ...overrides,
})

const folder = (id: string, parent: string, overrides: Partial<FakeNode> = {}): FakeNode => ({
  id,
  name: id,
  mimeType: FOLDER_MIME,
  modifiedTime: '2026-08-09T00:00:00Z',
  parent,
  ...overrides,
})

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

// A fetch-level fake Drive: answers the adapter's files.list queries from a node table (honouring
// the parent, folder/non-folder mime, and trashed clauses the adapter emits) and replays one
// scripted changes page. A node inside a trashed folder reports trashed = true itself, as Drive's
// v3 `trashed` field does for a trashed ancestor.
const installFakeDrive = (nodes: FakeNode[], changes: RawChange[] = []) => {
  const listCalls: string[] = []
  const effectivelyTrashed = (node: FakeNode): boolean => {
    if (node.trashed) return true
    const parent = nodes.find((n) => n.id === node.parent)
    return parent ? effectivelyTrashed(parent) : false
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    expect((init as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
    })
    if (url.pathname.endsWith('/changes/startPageToken')) {
      return json({ startPageToken: '1' })
    }
    if (url.pathname.endsWith('/changes')) {
      return json({ newStartPageToken: '9', changes })
    }
    if (url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') ?? ''
      listCalls.push(q)
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      let out = nodes.filter((n) => n.parent === parent)
      if (q.includes(`mimeType = '${FOLDER_MIME}'`)) {
        out = out.filter((n) => n.mimeType === FOLDER_MIME)
      }
      if (q.includes(`mimeType != '${FOLDER_MIME}'`)) {
        out = out.filter((n) => n.mimeType !== FOLDER_MIME)
      }
      if (q.includes('trashed = false')) {
        out = out.filter((n) => !effectivelyTrashed(n))
      }
      return json({
        files: out.map((n) => ({
          id: n.id,
          name: n.name,
          mimeType: n.mimeType,
          modifiedTime: n.modifiedTime,
          trashed: effectivelyTrashed(n),
        })),
      })
    }
    throw new Error(`fake drive: unexpected fetch ${url}`)
  })
  return { listCalls }
}

const client = () =>
  createGoogleDriveClient({
    serviceAccount: { clientEmail: 'svc@example.iam', privateKey: 'k' },
    folderId: ROOT,
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createGoogleDriveClient — subfolder recursion (ADR-0023)', () => {
  it('listCorpus returns documents at any depth and never the folders themselves', async () => {
    installFakeDrive([
      doc('root-doc', ROOT),
      folder('finance', ROOT),
      doc('salary-checklist', 'finance'),
      folder('finance-archive', 'finance'),
      doc('old-payroll', 'finance-archive'),
      doc('trashed-doc', 'finance', { trashed: true }),
    ])

    const { files, folders } = await client().listCorpus()

    expect(files.map((f) => f.id).sort()).toEqual(['old-payroll', 'root-doc', 'salary-checklist'])
    expect(files.every((f) => f.mimeType !== FOLDER_MIME)).toBe(true)
    // The folders come back in their own right, so a folder is real whether or not anything
    // readable is in it. The corpus root is not among them: it is the corpus, not a folder in it.
    expect(folders.map((f) => f.id).sort()).toEqual(['finance', 'finance-archive'])
    expect(folders.find((f) => f.id === 'finance-archive')?.parentId).toBe('finance')
    expect(folders.find((f) => f.id === 'finance')?.parentId).toBeNull()
  })

  // The count Drive reports for a folder, over every LIVE non-folder child — including the formats
  // the sync never ingests, which is the whole point of it, and excluding trashed files, which are
  // not in the folder as far as anybody looking at Drive is concerned. It is the only thing that
  // can tell a folder nobody has filed anything in from one holding three photos, and the tab says
  // something different about each.
  it('listCorpus counts the files Drive holds in a folder, readable or not', async () => {
    installFakeDrive([
      folder('finance', ROOT),
      doc('salary-checklist', 'finance'),
      doc('team-photo', 'finance', { name: 'team.png', mimeType: 'image/png' }),
      doc('trashed-doc', 'finance', { trashed: true }),
      folder('marketing', ROOT),
    ])

    const { folders } = await client().listCorpus()

    expect(folders.find((f) => f.id === 'finance')?.fileCount).toBe(2)
    // A folder with nothing in it is still a folder, and its count says which kind of empty.
    expect(folders.find((f) => f.id === 'marketing')?.fileCount).toBe(0)
  })

  // A file reports its whole path, and its two ends do two different jobs. The HEAD is the
  // top-level folder its branch begins with — the owning department, which classification reads,
  // and which must not move when somebody nests. The TAIL is the folder the file is actually in,
  // which is what the Knowledge tab mirrors. Before 2026-09-10 only the head existed, so a file in
  // finance/finance-archive could be found anywhere except finance-archive.
  it('listCorpus reports each document full folder path, empty at the root', async () => {
    installFakeDrive([
      doc('root-doc', ROOT),
      folder('finance', ROOT),
      doc('salary-checklist', 'finance'),
      folder('finance-archive', 'finance'),
      doc('old-payroll', 'finance-archive'),
    ])

    const { files } = await client().listCorpus()
    const paths = new Map(files.map((f) => [f.id, f.folderPath.map((leg) => leg.name)]))

    expect(paths.get('root-doc')).toEqual([])
    expect(paths.get('salary-checklist')).toEqual(['finance'])
    expect(paths.get('old-payroll')).toEqual(['finance', 'finance-archive'])
  })

  it('listChanges upserts a file changed inside a subfolder', async () => {
    installFakeDrive(
      [folder('finance', ROOT)],
      [
        {
          fileId: 'salary-checklist',
          file: {
            id: 'salary-checklist',
            name: 'salary.docx',
            mimeType: DOC_MIME,
            modifiedTime: '2026-08-09T01:00:00Z',
            parents: ['finance'],
          },
        },
      ],
    )

    const page = await client().listChanges('1')

    expect(page.changes).toEqual([
      {
        fileId: 'salary-checklist',
        removed: false,
        file: {
          id: 'salary-checklist',
          name: 'salary.docx',
          mimeType: DOC_MIME,
          modifiedTime: '2026-08-09T01:00:00Z',
          trashed: false,
          // Resolved through the changes feed exactly as a full load resolves it, so a document
          // cannot be classified one way when it is first ingested and another when it is edited.
          folderPath: [{ id: 'finance', name: 'finance' }],
        },
      },
    ])
  })

  it('listChanges still maps an out-of-corpus, trashed, or removed file to a deletion', async () => {
    installFakeDrive(
      [folder('finance', ROOT)],
      [
        { fileId: 'gone', removed: true },
        {
          fileId: 'elsewhere',
          file: {
            id: 'elsewhere',
            name: 'x.docx',
            mimeType: DOC_MIME,
            modifiedTime: '2026-08-09T01:00:00Z',
            parents: ['unrelated-folder'],
          },
        },
        {
          fileId: 'binned',
          file: {
            id: 'binned',
            name: 'y.docx',
            mimeType: DOC_MIME,
            modifiedTime: '2026-08-09T01:00:00Z',
            trashed: true,
            parents: ['finance'],
          },
        },
      ],
    )

    const page = await client().listChanges('1')

    expect(page.changes).toEqual([
      { fileId: 'gone', removed: true },
      { fileId: 'elsewhere', removed: true },
      { fileId: 'binned', removed: true },
    ])
  })

  it('expands a folder dragged into the corpus to upserts for the files it carries', async () => {
    installFakeDrive(
      [folder('imported', ROOT), doc('carried-doc', 'imported')],
      [
        {
          fileId: 'imported',
          file: {
            id: 'imported',
            name: 'imported',
            mimeType: FOLDER_MIME,
            modifiedTime: '2026-08-09T01:00:00Z',
            parents: [ROOT],
          },
        },
      ],
    )

    const page = await client().listChanges('1')

    expect(page.changes).toContainEqual({
      fileId: 'carried-doc',
      removed: false,
      file: expect.objectContaining({ id: 'carried-doc' }),
    })
    // The folder itself is never a document; whatever entry represents it must be a removal.
    const folderEntry = page.changes.find((c) => c.fileId === 'imported')
    expect(folderEntry?.removed ?? true).toBe(true)
  })

  it('expands a trashed corpus subfolder to removals for the files it takes with it', async () => {
    installFakeDrive(
      [folder('finance', ROOT, { trashed: true }), doc('salary-checklist', 'finance')],
      [
        {
          fileId: 'finance',
          file: {
            id: 'finance',
            name: 'finance',
            mimeType: FOLDER_MIME,
            modifiedTime: '2026-08-09T01:00:00Z',
            trashed: true,
            parents: [ROOT],
          },
        },
      ],
    )

    const page = await client().listChanges('1')

    expect(page.changes).toContainEqual({ fileId: 'salary-checklist', removed: true })
  })

  it('walks no folder queries on a quiet changes page', async () => {
    const { listCalls } = installFakeDrive([folder('finance', ROOT)], [])

    const page = await client().listChanges('1')

    expect(page.changes).toEqual([])
    expect(page.newStartPageToken).toBe('9')
    expect(listCalls).toEqual([])
  })
})

describe('createGoogleDriveClient — transient-failure retry', () => {
  const retryingClient = () =>
    createGoogleDriveClient({
      serviceAccount: { clientEmail: 'svc@example.iam', privateKey: 'k' },
      folderId: ROOT,
      retryDelayMs: 0,
    })

  it('retries a transient 500 and succeeds — one blip no longer kills a whole sync pass', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return { ok: false, status: 500 } as Response
      }
      return json({ startPageToken: '1' })
    })

    await expect(retryingClient().getStartPageToken()).resolves.toBe('1')
    expect(calls).toBe(2)
  })

  it('retries a dropped connection the same way', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        throw new TypeError('fetch failed')
      }
      return json({ startPageToken: '1' })
    })

    await expect(retryingClient().getStartPageToken()).resolves.toBe('1')
    expect(calls).toBe(2)
  })

  it('gives up after the third attempt when the failure persists', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      return { ok: false, status: 503 } as Response
    })

    await expect(retryingClient().getStartPageToken()).rejects.toThrow('responded 503')
    expect(calls).toBe(3)
  })

  it('never retries a semantic failure — a 404 is the answer, not a blip', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1
      return { ok: false, status: 404 } as Response
    })

    await expect(retryingClient().getStartPageToken()).rejects.toThrow('responded 404')
    expect(calls).toBe(1)
  })
})
