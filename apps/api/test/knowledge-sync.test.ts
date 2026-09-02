import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CONTENT_TRUNCATION_NOTICE,
  DOCX_MIME_TYPE,
  HTML_MIME_TYPE,
  MAX_DOC_CONTENT_CHARS,
  PDF_MIME_TYPE,
  PPTX_MIME_TYPE,
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
const HTML = fixture('branch-dashboard.html')

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

  it('an HTML page is ingested: visible text plus the JSON data its scripts would have rendered', async () => {
    await seedCursor()
    putFile('html-1', 'Branch dashboard.html', HTML_MIME_TYPE, HTML)
    const downloadsBefore = harness.drive.calls.downloadFile
    await reconcile()

    const doc = await readDoc('html-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.sourceMimeType).toBe(HTML_MIME_TYPE)
    // The rendered markup text, entities decoded.
    expect(doc?.content).toContain('לוח משימות שדרוגי סניפים')
    expect(doc?.content).toContain('Branch upgrades & tasks')
    // The corpus dashboards keep their whole content in `const X = [...]` script data and render
    // it client-side — the flattened records must surface, including rows nested under a parent.
    expect(doc?.content).toContain('[data]')
    expect(doc?.content).toContain('branch: Rehavia | status: in progress | due: 5.7.26')
    expect(doc?.content).toContain('group: signage | text: Replace the front sign')
    expect(doc?.content).toContain('branch: Talpiot | status: waiting')
    // Styling, script code, and JS-but-not-JSON runtime state never leak into grounding text.
    expect(doc?.content).not.toContain('font-family')
    expect(doc?.content).not.toContain('innerHTML')
    expect(doc?.content).not.toContain('owners')
    // It flowed through the Drive download port, not the Doc-export path.
    expect(harness.drive.calls.downloadFile).toBe(downloadsBefore + 1)
    expect((await harness.components.repo.listIngestedDocs()).map((d) => d.driveFileId)).toContain(
      'html-1',
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

  it('AC4 — an over-long doc is truncated, and the truncation is visible in the text', async () => {
    await seedCursor()
    // The cap is a runaway guard now, not a prompt budget — grounding selects chunks within its own
    // token budget, so document length no longer decides prompt size. What matters is that a cut
    // announces itself: it used to slice mid-word with no marker while the admin view still
    // reported the document as ingested.
    const oversized = `${'word '.repeat(MAX_DOC_CONTENT_CHARS / 5)}TAIL`
    putDoc('doc-long', 'Very long procedure', oversized)
    await reconcile()

    const content = (await readDoc('doc-long'))?.content ?? ''
    expect(content).toContain(CONTENT_TRUNCATION_NOTICE.trim())
    expect(content).not.toContain('TAIL')
    // Cut at a word boundary, so the last surviving word is whole.
    expect(content.slice(0, content.indexOf('[')).trimEnd().endsWith('word')).toBe(true)
  })

  it('ingests a doc that would have been truncated by the old 20k cap whole', async () => {
    await seedCursor()
    const long = `${'word '.repeat(8_000)}FINAL_MARKER`
    expect(long.length).toBeGreaterThan(20_000)
    putDoc('doc-40k', 'A long real procedure', long)
    await reconcile()

    const content = (await readDoc('doc-40k'))?.content ?? ''
    expect(content).toContain('FINAL_MARKER')
    expect(content).not.toContain(CONTENT_TRUNCATION_NOTICE.trim())
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
  // --- Resilience: one bad file, a deleted file, and a dead cursor ---

  it('quarantines an unreadable file instead of wedging every future sync', async () => {
    await seedCursor()
    putDoc('doc-good', 'Readable', 'The opening procedure.')
    // A DOCX whose bytes are not a zip: mammoth throws deterministically over bytes already in
    // hand, which is exactly what an encrypted or corrupt upload does. Before this the throw
    // escaped the change loop, the cursor never advanced, and the SAME change replayed on every
    // pass forever — one file dropped in Drive froze the whole corpus chain-wide.
    putFile('doc-bad', 'Corrupt', DOCX_MIME_TYPE, Buffer.from('not a zip at all'))

    await reconcile()

    // The good doc got through, and the bad one is a visible skipped row with a reason rather
    // than an exception.
    expect(await ingestedIds()).toEqual(['doc-good'])
    const bad = await readDoc('doc-bad')
    expect(bad?.status).toBe('skipped')
    expect(bad?.skipReason).toContain('could not be read')
    expect(harness.documentErrors.map((e) => e.driveFileId)).toContain('doc-bad')

    // The cursor advanced, so a later edit is seen instead of replaying the poisoned change.
    putDoc('doc-later', 'Added after', 'Still syncing.')
    await reconcile()
    expect((await ingestedIds()).sort()).toEqual(['doc-good', 'doc-later'])
  })

  it('still aborts the pass when a download fails, so the change is retried not lost', async () => {
    await seedCursor()
    putDoc('doc-1', 'Wanted', 'Content.')
    // A read failure is I/O: transient by nature, and swallowing it would drop this change
    // permanently, because the cursor would advance past a file that never got ingested.
    harness.drive.failReadOf('doc-1')

    await expect(reconcile()).rejects.toThrow()
    expect(await readDoc('doc-1')).toBeUndefined()

    // The cursor did not advance, so once the outage clears the same change is picked up.
    harness.drive.clearReadErrors()
    await reconcile()
    expect(await readDoc('doc-1')).toBeDefined()
  })

  it('purges a doc deleted from Drive while no cursor existed', async () => {
    putDoc('doc-keep', 'Kept', 'Still in the folder.')
    putDoc('doc-gone', 'Withdrawn', 'This SOP was deleted from Drive.')
    await reconcile() // full load ingests both
    expect((await ingestedIds()).sort()).toEqual(['doc-gone', 'doc-keep'])

    // Drop the file AND the cursor: the state after weeks of downtime, or after a hand-recovery.
    // The changes feed can no longer report the removal, so only a listing diff can find it —
    // and without one the withdrawn document kept being cited, which is what happened in 2026-08.
    harness.drive.removeFile('doc-gone')
    await harness.clearCursor()

    await reconcile() // full load again

    expect(await readDoc('doc-gone')).toBeUndefined()
    expect(await ingestedIds()).toEqual(['doc-keep'])
    // And it said so, rather than removing rows silently.
    expect(harness.documentErrors.map((e) => e.driveFileId)).toContain('full-load-purge')
  })

  it('recovers from an expired page token by re-deriving one', async () => {
    await seedCursor()
    putDoc('doc-1', 'Present', 'Content.')
    await reconcile()

    // Drive answers 410 once the persisted token is too old — what a long outage produces. It is
    // permanent: replaying the same token can only ever fail again, so before this the corpus
    // stopped updating until someone deleted the cursor row by hand.
    harness.drive.expirePageToken()
    putDoc('doc-2', 'Added during the outage', 'Also content.')

    await reconcile()

    // The pass recovered on its own and the folder is fully represented again.
    expect((await ingestedIds()).sort()).toEqual(['doc-1', 'doc-2'])
    expect(harness.documentErrors.map((e) => e.driveFileId)).toContain('sync-cursor')
  })
  // --- Change detection: a Drive event that changed nothing costs nothing ---

  it('keeps a doc chunks when a re-sync brings identical text', async () => {
    await seedCursor()
    putDoc('doc-1', 'Opening procedure', 'Sanitize the surfaces before open.')
    await reconcile()
    const before = await harness.chunkIdsOf('doc-1')
    expect(before.length).toBeGreaterThan(0)

    // The same file reported again with the same title and text — what a move, a sharing change, or
    // a folder-level edit fanning out to its children produces. This used to wipe and rebuild every
    // chunk, which since the language bridge means one premium completion plus a fresh embedding
    // per chunk for text that had not changed by a byte.
    putDoc(
      'doc-1',
      'Opening procedure',
      'Sanitize the surfaces before open.',
      '2026-03-01T00:00:00.000Z',
    )
    await reconcile()

    expect(await harness.chunkIdsOf('doc-1')).toEqual(before)
  })

  it('rebuilds a doc chunks when the text really changes', async () => {
    await seedCursor()
    putDoc('doc-1', 'Opening procedure', 'Sanitize the surfaces before open.')
    await reconcile()
    const before = await harness.chunkIdsOf('doc-1')

    putDoc('doc-1', 'Opening procedure', 'Sanitize the surfaces AND check the fridge temperatures.')
    await reconcile()

    const after = await harness.chunkIdsOf('doc-1')
    expect(after.length).toBeGreaterThan(0)
    expect(after).not.toEqual(before)
  })

  it('rebuilds a doc chunks when only the title changes', async () => {
    // The title is prepended to the text a chunk is embedded as and is named in the gist prompt, so
    // a rename does change the index even though the stored chunk text is bare.
    await seedCursor()
    putDoc('doc-1', 'Opening procedure', 'Sanitize the surfaces before open.')
    await reconcile()
    const before = await harness.chunkIdsOf('doc-1')

    putDoc('doc-1', 'Morning opening procedure', 'Sanitize the surfaces before open.')
    await reconcile()

    expect(await harness.chunkIdsOf('doc-1')).not.toEqual(before)
  })
})

// Visual transcription in the sync (2026-09 plan, phase 2): a diagram-flagged DOCX or deck is
// handed to the transcriber before its skip is persisted — a faithful transcription ingests as
// the document's content, and a failed one leaves the flagged row exactly as phase 1 wrote it.
// The transcriber rides the same injected LLM the categorizer uses; its chart calls are told
// apart here by their system turn, the way an obedient model would see them.
describe('assistant: visual transcription in the sync (2026-09 phase 2)', () => {
  let harness: AssistantHarness

  beforeAll(async () => {
    harness = await createAssistantHarness()
  })
  afterAll(async () => {
    await harness?.close()
  })
  beforeEach(async () => {
    await harness.reset()
    harness.llm.reset()
    harness.llm.setDefaultAnswer('general')
  })

  const reconcile = () => harness.components.syncService.reconcile()
  const readDoc = (driveFileId: string) => harness.components.repo.getDocByDriveFileId(driveFileId)

  const EMU_PER_CM = 360000
  const box = (label: string, xCm: number, yCm: number, prst = 'rect'): string => `
    <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>
      <wp:anchor>
        <wp:positionH relativeFrom="page"><wp:posOffset>${xCm * EMU_PER_CM}</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:posOffset>${yCm * EMU_PER_CM}</wp:posOffset></wp:positionV>
        <wp:extent cx="${4 * EMU_PER_CM}" cy="${EMU_PER_CM}"/>
        <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
          <wps:wsp><wps:spPr><a:prstGeom prst="${prst}"/></wps:spPr>
          ${label === '' ? '' : `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:txbxContent></wps:txbx>`}
          </wps:wsp>
        </a:graphicData></a:graphic>
      </wp:anchor>
    </w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape/></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`

  const buildChartDocx = async (): Promise<Buffer> => {
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    )
    zip.file(
      '_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    )
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
        xmlns:v="urn:schemas-microsoft-com:vml">
        <w:body>${[box('מנהלת רשת', 8, 1), box('מנהל תפעול', 4, 4), box('מנהלת כספים', 12, 4)].join('')}</w:body>
      </w:document>`,
    )
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  const buildPlaceholderDeck = async (): Promise<Buffer> => {
    const zip = new JSZip()
    zip.file(
      'ppt/presentation.xml',
      `<?xml version="1.0"?>
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      </p:presentation>`,
    )
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="s" Target="slides/slide1.xml"/></Relationships>`,
    )
    zip.file(
      'ppt/slides/slide1.xml',
      `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>נהלי פתיחת סניף</a:t></a:r></a:p></p:txBody></p:sp>
          <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>יש להגיע שעה לפני הפתיחה ולהדליק את כל העמדות לפי הסדר.</a:t></a:r></a:p></p:txBody></p:sp>
        </p:spTree></p:cSld>
      </p:sld>`,
    )
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  const TRANSCRIPTION = [
    'מבנה הרשת:',
    'מנהלת רשת עומדת בראש המבנה.',
    'מנהל תפעול כפוף למנהלת רשת.',
    'מנהלת כספים כפופה למנהלת רשת.',
  ].join('\n')

  it('ingests a diagram-flagged DOCX through the transcriber instead of skipping it', async () => {
    harness.llm.respondWith((request) =>
      request.messages[0]?.content.includes('מתמלל')
        ? { ok: true, content: TRANSCRIPTION }
        : { ok: true, content: 'general' },
    )
    harness.drive.putDoc('chart-1', {
      name: 'מבנה אירגוני.docx',
      mimeType: DOCX_MIME_TYPE,
      bytes: await buildChartDocx(),
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })

    await harness.components.syncService.reconcile()

    const doc = await readDoc('chart-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.skipReason).toBeNull()
    expect(doc?.content).toContain('מנהל תפעול כפוף למנהלת רשת.')
    // Provenance rides the row, never the indexed text: the old inline '[תמלול אוטומטי]' marker
    // put its words into every transcribed doc's keyword statistics.
    expect(doc?.content).not.toContain('[תמלול אוטומטי')
    expect(doc?.transcribedAt).toBeInstanceOf(Date)
  })

  it('keeps the phase-1 flag when the transcription cannot be validated, and reports it', async () => {
    // The default 'general' reply never contains the box labels — both attempts fail the
    // anti-miss validator, and the document must stay exactly as phase 1 left it.
    harness.drive.putDoc('chart-2', {
      name: 'תרשים זרימה.docx',
      mimeType: DOCX_MIME_TYPE,
      bytes: await buildChartDocx(),
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })

    await reconcile()

    const doc = await readDoc('chart-2')
    expect(doc?.status).toBe('skipped')
    expect(doc?.skipReason).toContain('iagram')
    expect(
      harness.documentErrors.some(
        (e) => e.driveFileId === 'chart-2' && String(e.error).includes('transcription'),
      ),
    ).toBe(true)
  })

  it('ingests a text deck (pptx) through the new reader with slide markers', async () => {
    harness.drive.putDoc('deck-1', {
      name: 'נהלי פתיחה.pptx',
      mimeType: PPTX_MIME_TYPE,
      bytes: await buildPlaceholderDeck(),
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })

    await reconcile()

    const doc = await readDoc('deck-1')
    expect(doc?.status).toBe('ingested')
    expect(doc?.content).toContain('[slide 1]')
    expect(doc?.content).toContain('נהלי פתיחת סניף')
    // Authored content, not machine transcription — the provenance stamp stays empty.
    expect(doc?.transcribedAt).toBeNull()
  })
})
