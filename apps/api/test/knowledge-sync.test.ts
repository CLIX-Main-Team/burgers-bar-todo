import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GOOGLE_DOC_MIME_TYPE } from '../src/assistant/drive-client.js'
import { type AssistantHarness, createAssistantHarness } from './helpers/assistant-harness.js'

// Knowledge cache and Drive reconciliation (#87): the local mirror of the Drive corpus stays
// consistent with Drive through one idempotent, single-flight reconciliation pass, with Google
// Docs as the ingested format. Every assertion is external-behaviour-only — cache state seen
// through the repository's follow-up reads after a sync, and the fake Drive's call counts —
// never by reading rows or internals directly. The injected clock and the scriptable fake Drive
// are the only substitutions; the sync runs against a real migrated Postgres with no network.

const DOC_MIME = GOOGLE_DOC_MIME_TYPE

describe('assistant: knowledge cache + Drive reconciliation (#87)', () => {
  let harness: AssistantHarness

  beforeAll(async () => {
    harness = await createAssistantHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
  })

  // Reconcile once to seed the changes cursor at the current end of the feed, the way
  // provisioning seeds it before authors add docs (ADR-0014). Docs authored after this are the
  // ones a following sync sees.
  const seedCursor = () => harness.components.syncService.reconcile()
  const reconcile = () => harness.components.syncService.reconcile()

  const putDoc = (
    fileId: string,
    name: string,
    content: string,
    modifiedTime = '2026-02-01T00:00:00.000Z',
  ) => harness.drive.putDoc(fileId, { name, mimeType: DOC_MIME, content, modifiedTime })

  const readDoc = (driveFileId: string) => harness.components.repo.getDocByDriveFileId(driveFileId)

  // --- A synced Google Doc becomes observable cache state ---

  it('AC3 — a Google Doc synced from Drive becomes cache state observable through a follow-up read', async () => {
    await seedCursor()
    putDoc('doc-1', 'Closing the grill', 'Step 1: turn off the gas.')
    await reconcile()

    const doc = await readDoc('doc-1')
    expect(doc).toMatchObject({
      driveFileId: 'doc-1',
      title: 'Closing the grill',
      content: 'Step 1: turn off the gas.',
      sourceMimeType: DOC_MIME,
      status: 'ingested',
      // Chain-wide in v1: location_id is null (ADR-0014).
      locationId: null,
    })
    // The Drive revision is carried as reconciliation metadata.
    expect(doc?.driveModifiedTime).toEqual(new Date('2026-02-01T00:00:00.000Z'))

    // And it is part of the answerable corpus a grounding read would inject.
    const ingested = await harness.components.repo.listIngestedDocs()
    expect(ingested.map((d) => d.driveFileId)).toEqual(['doc-1'])
  })

  // --- Edit, delete, trash, and cursor advance across syncs ---

  it('AC4 — an edited Doc updates its cache row after a sync', async () => {
    await seedCursor()
    putDoc('doc-1', 'Refund policy', 'Refunds within 14 days.', '2026-02-01T00:00:00.000Z')
    await reconcile()
    expect((await readDoc('doc-1'))?.content).toBe('Refunds within 14 days.')

    // The author edits the same Doc in Drive: new content and a newer revision.
    putDoc('doc-1', 'Refund policy', 'Refunds within 30 days.', '2026-03-01T00:00:00.000Z')
    await reconcile()

    const doc = await readDoc('doc-1')
    expect(doc?.content).toBe('Refunds within 30 days.')
    expect(doc?.driveModifiedTime).toEqual(new Date('2026-03-01T00:00:00.000Z'))
    // Still one row for the file — the edit updated in place, it did not duplicate.
    const ingested = await harness.components.repo.listIngestedDocs()
    expect(ingested.filter((d) => d.driveFileId === 'doc-1')).toHaveLength(1)
  })

  it('AC4 — a removed Doc deletes its cache row after a sync', async () => {
    await seedCursor()
    putDoc('doc-1', 'Old procedure', 'Do the old thing.')
    await reconcile()
    expect(await readDoc('doc-1')).toBeDefined()

    // The author removes the Doc from the folder; the next sync deletes its row.
    harness.drive.removeFile('doc-1')
    await reconcile()

    expect(await readDoc('doc-1')).toBeUndefined()
    expect(await harness.components.repo.listIngestedDocs()).toHaveLength(0)
  })

  it('AC4 — a trashed Doc deletes its cache row, so a trashed procedure stops grounding', async () => {
    await seedCursor()
    putDoc('doc-1', 'Retired policy', 'No longer valid.')
    await reconcile()
    expect(await readDoc('doc-1')).toBeDefined()

    // Trashing arrives as a non-removed change whose metadata is trashed = true.
    harness.drive.putDoc('doc-1', {
      name: 'Retired policy',
      mimeType: DOC_MIME,
      content: 'No longer valid.',
      modifiedTime: '2026-03-01T00:00:00.000Z',
      trashed: true,
    })
    await reconcile()

    expect(await readDoc('doc-1')).toBeUndefined()
  })

  it('AC4 — the cursor advances across syncs: each sync sees only changes since the last', async () => {
    await seedCursor()
    putDoc('doc-1', 'First', 'One.')
    await reconcile()

    // A doc added after the previous sync is picked up by the next one from the advanced cursor.
    putDoc('doc-2', 'Second', 'Two.')
    await reconcile()
    expect(await readDoc('doc-1')).toBeDefined()
    expect(await readDoc('doc-2')).toBeDefined()

    // A sync with nothing new touches Drive but changes no cache state — the cursor has moved
    // past every applied change, so there is nothing to replay.
    const before = harness.drive.calls.exportDoc
    await reconcile()
    expect(harness.drive.calls.exportDoc).toBe(before)
    expect(await harness.components.repo.listIngestedDocs()).toHaveLength(2)
  })

  // --- Pagination: the drain walks every page ---

  it('drains a multi-page changes feed in one pass', async () => {
    await seedCursor()
    putDoc('doc-1', 'A', 'a')
    putDoc('doc-2', 'B', 'b')
    putDoc('doc-3', 'C', 'c')
    // One change per page forces the drain loop across nextPageToken boundaries.
    harness.drive.setPageSize(1)

    await reconcile()

    for (const id of ['doc-1', 'doc-2', 'doc-3']) {
      expect(await readDoc(id)).toBeDefined()
    }
    // Three single-change pages plus the terminating page carrying newStartPageToken.
    expect(harness.drive.calls.listChanges).toBeGreaterThanOrEqual(3)
  })

  // --- Idempotency ---

  it('AC5 — repeated syncs are idempotent: re-running changes nothing and never duplicates', async () => {
    await seedCursor()
    putDoc('doc-1', 'Stable', 'Unchanged content.')
    await reconcile()

    await reconcile()
    await reconcile()

    const doc = await readDoc('doc-1')
    expect(doc?.content).toBe('Unchanged content.')
    expect(await harness.components.repo.listIngestedDocs()).toHaveLength(1)
  })

  // --- Single-flight ---

  it('AC5 — concurrent reconciliation calls coalesce to a single sync in flight', async () => {
    await seedCursor()
    putDoc('doc-1', 'One', 'a')
    putDoc('doc-2', 'Two', 'b')
    putDoc('doc-3', 'Three', 'c')

    const baseline = { ...harness.drive.calls }

    // A crowd of callers in the same tick — a shift-open login rush — all reconcile at once.
    await Promise.all(Array.from({ length: 8 }, () => reconcile()))

    // The feed was walked once, not eight times, and each doc was exported exactly once —
    // eight independent passes would multiply both counts.
    expect(harness.drive.calls.listChanges - baseline.listChanges).toBe(1)
    expect(harness.drive.calls.exportDoc - baseline.exportDoc).toBe(3)
    // The cursor was already seeded, so no coalesced pass re-obtained a start token.
    expect(harness.drive.calls.getStartPageToken - baseline.getStartPageToken).toBe(0)

    for (const id of ['doc-1', 'doc-2', 'doc-3']) {
      expect(await readDoc(id)).toBeDefined()
    }
  })

  // --- Format boundary and cursor semantics ---

  it('ingests only Google Docs; a non-Doc file is left uncached in this slice', async () => {
    await seedCursor()
    putDoc('doc-1', 'A real doc', 'Grounded content.')
    // A PDF dropped in the folder — a format the next ticket handles; not cached here.
    harness.drive.putDoc('pdf-1', {
      name: 'menu.pdf',
      mimeType: 'application/pdf',
      content: '%PDF-1.7 ...',
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })
    await reconcile()

    expect(await readDoc('doc-1')).toBeDefined()
    expect(await readDoc('pdf-1')).toBeUndefined()
  })

  it('a doc authored before the first sync seeds the cursor is not retro-ingested', async () => {
    // No cursor seeded yet: the very first sync obtains a start page token at the current end of
    // the feed, so a doc already present is behind the cursor and not replayed — the corpus is
    // authored after provisioning seeds the cursor (ADR-0014). A later edit to that doc does
    // land, because the edit is a fresh change ahead of the cursor.
    putDoc('doc-1', 'Pre-existing', 'Authored before seeding.')
    await reconcile()
    expect(await readDoc('doc-1')).toBeUndefined()

    putDoc('doc-1', 'Pre-existing', 'Edited after seeding.', '2026-03-01T00:00:00.000Z')
    await reconcile()
    expect((await readDoc('doc-1'))?.content).toBe('Edited after seeding.')
  })
})
