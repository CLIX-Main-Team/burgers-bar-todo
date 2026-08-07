import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  DOCX_MIME_TYPE,
  MAX_DOC_CONTENT_CHARS,
  PDF_MIME_TYPE,
  XLSX_MIME_TYPE,
} from '../src/assistant/document-extraction.js'
import { GOOGLE_DOC_MIME_TYPE } from '../src/assistant/drive-client.js'
import { type AssistantHarness, createAssistantHarness } from './helpers/assistant-harness.js'

// Real corpus fixtures, read as bytes and fed through the fake Drive's downloadFile port so
// pdf.js and mammoth run for real against them (see fixtures/readme.md). The tests assert only
// external behaviour — cache state after a sync — never the extractor in isolation.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
const TEXT_PDF = fixture('text-procedure.pdf')
const DOCX = fixture('refund-policy.docx')
const SCANNED_PDF = fixture('scanned-procedure.pdf')
const XLSX = fixture('shift-roster.xlsx')

// Knowledge cache and Drive reconciliation (#87) plus multi-format ingestion (#88): the local
// mirror of the Drive corpus stays consistent with Drive through one idempotent, single-flight
// reconciliation pass. Google Docs are exported to text; text-layer PDFs and DOCX files are
// downloaded and extracted (pdf.js/mammoth run for real against fixtures); a scanned/image-only
// PDF is skipped-and-flagged. Every assertion is external-behaviour-only — cache state seen
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

  // Reconcile once against an empty folder to seed the changes cursor at the current end of the
  // feed, isolating the incremental path from the first-sync full load (ADR-0021): with nothing in
  // the folder yet, the full load ingests nothing and simply seeds the cursor, so docs authored
  // after this are seen through the changes feed the following incremental sync walks.
  const seedCursor = () => harness.components.syncService.reconcile()
  const reconcile = () => harness.components.syncService.reconcile()

  const putDoc = (
    fileId: string,
    name: string,
    content: string,
    modifiedTime = '2026-02-01T00:00:00.000Z',
  ) => harness.drive.putDoc(fileId, { name, mimeType: DOC_MIME, content, modifiedTime })

  // Author a binary file (PDF/DOCX) into the corpus: raw fixture bytes the sync reads back
  // through the downloadFile port, exactly as a real Drive download would deliver them.
  const putFile = (
    fileId: string,
    name: string,
    mimeType: string,
    bytes: Buffer,
    modifiedTime = '2026-02-01T00:00:00.000Z',
  ) => harness.drive.putDoc(fileId, { name, mimeType, bytes, modifiedTime })

  const readDoc = (driveFileId: string) => harness.components.repo.getDocByDriveFileId(driveFileId)

  const ingestedIds = async () =>
    (await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)

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

  it('leaves an unsupported format uncached, so it never grounds an answer', async () => {
    await seedCursor()
    putDoc('doc-1', 'A real doc', 'Grounded content.')
    // A format the assistant does not ingest (a spreadsheet) — no row at all, distinct from a
    // skipped doc, so it never appears in the cache.
    harness.drive.putDoc('sheet-1', {
      name: 'roster.xlsx',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      content: 'ignored',
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })
    await reconcile()

    expect(await readDoc('doc-1')).toBeDefined()
    expect(await readDoc('sheet-1')).toBeUndefined()
  })

  // --- Multi-format ingestion (#88): text PDF, DOCX, scanned-skip-and-flag, length cap ---

  it('AC1 — a text-layer PDF is ingested and its extracted text becomes cache content', async () => {
    await seedCursor()
    putFile('pdf-1', 'Closing the grill.pdf', PDF_MIME_TYPE, TEXT_PDF)
    const downloadsBefore = harness.drive.calls.downloadFile
    await reconcile()

    const doc = await readDoc('pdf-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.sourceMimeType).toBe(PDF_MIME_TYPE)
    // The real text layer pdf.js recovered — asserted by phrase, since exact spacing is pdf.js's.
    expect(doc?.content).toContain('Closing the grill station')
    expect(doc?.content).toContain('Turn off the gas')
    // It flowed through the Drive download port, not the Doc-export path.
    expect(harness.drive.calls.downloadFile).toBe(downloadsBefore + 1)
    // And it is part of the answerable corpus grounding would inject.
    expect((await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)).toContain(
      'pdf-1',
    )
  })

  it('AC2 — a DOCX is ingested and its extracted text becomes cache content', async () => {
    await seedCursor()
    putFile('docx-1', 'Refund policy.docx', DOCX_MIME_TYPE, DOCX)
    await reconcile()

    const doc = await readDoc('docx-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.content).toContain('Refunds are issued within 14 days')
    expect((await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)).toContain(
      'docx-1',
    )
  })

  it('an Excel workbook is ingested: every sheet becomes CSV cache content under its tab name', async () => {
    await seedCursor()
    putFile('xlsx-1', 'Shift roster.xlsx', XLSX_MIME_TYPE, XLSX)
    const downloadsBefore = harness.drive.calls.downloadFile
    await reconcile()

    const doc = await readDoc('xlsx-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.sourceMimeType).toBe(XLSX_MIME_TYPE)
    // Both tabs are present, each announced by its name — the tab name is often the only
    // label for what a table is about, so grounding keeps it.
    expect(doc?.content).toContain('[sheet: Week 32]')
    expect(doc?.content).toContain('[sheet: Suppliers]')
    // Cell values from each tab, as CSV rows.
    expect(doc?.content).toContain('Noa,Manager,06:00-14:00,8')
    expect(doc?.content).toContain('Bakery Golan,03-1234567')
    // A formula cell reads out as its cached result, not the formula.
    expect(doc?.content).toContain('Total,,,16')
    // It flowed through the Drive download port, not the Doc-export path.
    expect(harness.drive.calls.downloadFile).toBe(downloadsBefore + 1)
    expect((await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)).toContain(
      'xlsx-1',
    )
  })

  it('AC3 — a scanned/image-only PDF is skipped, flagged with a reason, and never grounds', async () => {
    await seedCursor()
    // A readable procedure and a scan of one, side by side.
    putFile('pdf-good', 'Readable.pdf', PDF_MIME_TYPE, TEXT_PDF)
    putFile('pdf-scan', 'Scanned menu.pdf', PDF_MIME_TYPE, SCANNED_PDF)
    await reconcile()

    const scanned = await readDoc('pdf-scan')
    // Skipped with content null and an admin-visible reason saying why it could not be read.
    expect(scanned?.status).toBe('skipped')
    expect(scanned?.content).toBeNull()
    expect(scanned?.skipReason).toMatch(/scanned or image-only/i)

    // It is not in the answerable corpus — only the readable PDF grounds, the scan never does.
    const grounded = (await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)
    expect(grounded).toContain('pdf-good')
    expect(grounded).not.toContain('pdf-scan')
  })

  it('AC3 — a scanned PDF that later gains a text layer flips skipped → ingested and clears its reason', async () => {
    await seedCursor()
    putFile('pdf-1', 'Menu.pdf', PDF_MIME_TYPE, SCANNED_PDF)
    await reconcile()
    expect((await readDoc('pdf-1'))?.status).toBe('skipped')

    // The same file is re-uploaded with a real text layer (a newer revision).
    putFile('pdf-1', 'Menu.pdf', PDF_MIME_TYPE, TEXT_PDF, '2026-03-01T00:00:00.000Z')
    await reconcile()

    const doc = await readDoc('pdf-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.content).toContain('Closing the grill station')
  })

  it('AC4 — an ingested doc is truncated to the per-doc length cap', async () => {
    await seedCursor()
    // An over-long doc — grounding injects doc text directly, so the cap bounds the prompt.
    const oversized = 'a'.repeat(MAX_DOC_CONTENT_CHARS + 500)
    putDoc('doc-long', 'Very long procedure', oversized)
    await reconcile()

    expect((await readDoc('doc-long'))?.content).toHaveLength(MAX_DOC_CONTENT_CHARS)
  })

  // --- Full load on the first ever sync (ADR-0021, reversing ADR-0014's changes-feed-only model) ---

  it('ADR-0021 — a never-synced knowledge base full-loads every document already in the folder', async () => {
    // No seedCursor first: the folder is already populated before the very first sync — the
    // fresh-deployment case, where the docs predate any cursor and the changes feed will never
    // report them. Listing the folder is the only way to pick them up.
    putDoc('doc-1', 'Closing the grill', 'Turn off the gas.')
    putDoc('doc-2', 'Refund policy', 'Refunds within 14 days.')
    await reconcile()

    expect((await readDoc('doc-1'))?.content).toBe('Turn off the gas.')
    expect((await readDoc('doc-2'))?.content).toBe('Refunds within 14 days.')
    expect(await ingestedIds()).toEqual(expect.arrayContaining(['doc-1', 'doc-2']))
    // The folder was listed exactly once for the full load, and the cursor is now seeded.
    expect(harness.drive.calls.listFiles).toBe(1)
    // The full load ingests from the folder listing — which the real adapter scopes server-side to
    // the one folder — and never replays the account-wide changes feed, so a file outside the
    // folder (which only the feed could surface) is never ingested by it.
    expect(harness.drive.calls.listChanges).toBe(0)
  })

  it('ADR-0021 — after the full load the next reconcile is incremental, and a later edit is caught by it', async () => {
    putDoc('doc-1', 'Policy', 'Refunds within 14 days.', '2026-02-01T00:00:00.000Z')
    await reconcile() // full load
    expect(harness.drive.calls.listFiles).toBe(1)

    // An edit lands after the load. Because the cursor was captured before the listing, the next
    // reconcile walks the changes feed (not another full load) and catches it.
    putDoc('doc-1', 'Policy', 'Refunds within 30 days.', '2026-03-01T00:00:00.000Z')
    const listChangesBefore = harness.drive.calls.listChanges
    await reconcile()

    expect(harness.drive.calls.listFiles).toBe(1) // no second full load
    expect(harness.drive.calls.listChanges).toBeGreaterThan(listChangesBefore)
    expect((await readDoc('doc-1'))?.content).toBe('Refunds within 30 days.')
  })

  it('ADR-0021 — the full load is best-effort: one unreadable document is reported and skipped, the rest ingest', async () => {
    putDoc('doc-1', 'Readable one', 'Grounded content.')
    putDoc('doc-bad', 'Broken', 'never read')
    putDoc('doc-2', 'Readable two', 'More grounded content.')
    // A genuine per-document error — the export throws for this one file.
    harness.drive.failReadOf('doc-bad')
    await reconcile()

    // The failure was reported and skipped; the rest of the corpus still ingested.
    expect(await readDoc('doc-1')).toBeDefined()
    expect(await readDoc('doc-2')).toBeDefined()
    expect(await readDoc('doc-bad')).toBeUndefined()
    expect(harness.documentErrors.map((e) => e.driveFileId)).toEqual(['doc-bad'])

    // The cursor was still persisted despite the failure: the next reconcile is incremental.
    await reconcile()
    expect(harness.drive.calls.listFiles).toBe(1)
  })

  it('ADR-0021 — a full load that fails before completion does not persist the cursor and retries next time', async () => {
    putDoc('doc-1', 'Policy', 'Refunds within 14 days.')
    // Drive is unavailable while the first load tries to list the folder — a startup outage.
    harness.drive.failNextListFiles()
    await expect(reconcile()).rejects.toThrow()
    expect(await readDoc('doc-1')).toBeUndefined()

    // No cursor was persisted, so the next reconcile retries the full load from scratch — and now
    // that Drive is healthy again, it succeeds. A transient outage at startup self-heals.
    await reconcile()
    expect(await readDoc('doc-1')).toBeDefined()
    expect(harness.drive.calls.listFiles).toBe(2)
  })

  it('ADR-0021 — a scanned PDF full-loads as a skipped row, not an error, and the KB is then synced', async () => {
    putFile('pdf-scan', 'Scanned menu.pdf', PDF_MIME_TYPE, SCANNED_PDF)
    await reconcile()

    const scanned = await readDoc('pdf-scan')
    expect(scanned?.status).toBe('skipped')
    expect(scanned?.content).toBeNull()
    expect(scanned?.skipReason).toMatch(/scanned or image-only/i)
    // A skip is not a best-effort error.
    expect(harness.documentErrors).toHaveLength(0)

    // The cursor advanced even though the only doc was skipped: the KB is not "never synced" (that
    // is "no cursor", not "zero ingested docs"), so the next reconcile is incremental, not a full load.
    await reconcile()
    expect(harness.drive.calls.listFiles).toBe(1)
  })

  it('ADR-0021 — a document moved out of the folder (a removal on the feed) stops grounding', async () => {
    putDoc('doc-1', 'In folder', 'Grounded.')
    await reconcile() // full load
    expect(await readDoc('doc-1')).toBeDefined()

    // The real adapter forwards a moved-out / trashed / removed file as a removal; the next
    // reconcile deletes its cache row — folder membership is the source of truth for the corpus.
    harness.drive.removeFile('doc-1')
    await reconcile()
    expect(await readDoc('doc-1')).toBeUndefined()
    expect(await ingestedIds()).toHaveLength(0)
  })
})
