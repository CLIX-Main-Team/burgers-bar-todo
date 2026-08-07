import mammoth from 'mammoth'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as xlsx from 'xlsx'

// Text extraction for the non-Doc corpus formats (#88): a text-layer PDF (pdf.js), a Word
// document (mammoth), and an Excel workbook (SheetJS) become plain text the knowledge cache can
// ground on. This module is pure —
// it takes bytes and returns an outcome, with no Drive or database dependency — so the
// reconciliation pass stays the single owner of I/O and this stays trivially reasoned about.
//
// Two decisions live here and nowhere else, because grounding injects a doc's text directly into
// the answer prompt:
//   - A document the system cannot actually read (a scanned or image-only PDF with no text layer)
//     is *skipped and flagged*, not silently ingested as empty — a doc that grounds nothing must
//     say why, so an admin sees it was skipped rather than assuming it was answered from. OCR is
//     out of v1.
//   - Every ingested doc is truncated to a per-doc character cap, so one over-long procedure
//     cannot blow the answer's token budget.

// The Drive mime types this module reads. Google Docs are handled by the sync's export path
// (drive-client.ts); these are the download-and-extract formats.
export const PDF_MIME_TYPE = 'application/pdf'
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// The per-doc content cap. Grounding concatenates cached docs into the model prompt, so an
// unbounded doc is an unbounded prompt; ~20k characters (~5k tokens) keeps any single procedure
// well within budget while comfortably fitting a real one whole. A hard slice, not a summariser —
// summarisation is a later concern, this is only the budget guard.
export const MAX_DOC_CONTENT_CHARS = 20_000

// Below this many non-whitespace characters, an extraction counts as "no readable text layer":
// a scanned or image-only PDF yields zero, and a handful of stray glyphs is still not a document
// worth grounding on. This is the line between ingested and skipped-and-flagged.
const MIN_READABLE_CHARS = 16

// The reason an admin sees for a skipped doc. Phrased as what happened and why, since it
// surfaces on the admin knowledge view as the explanation for a doc that grounds nothing. Only
// the scanned/image-only PDF is skipped: it is the one format the system tries and fails to read.
export const SCANNED_PDF_SKIP_REASON =
  'Scanned or image-only PDF: no extractable text layer (OCR is not supported).'

// An ingested doc carries capped text and no skip reason; a skipped one carries the reason and no
// text. The two never disagree — the shape makes "ingested with a reason" unrepresentable.
export interface IngestedDocument {
  status: 'ingested'
  content: string
  skipReason: null
}
export interface SkippedDocument {
  status: 'skipped'
  content: null
  skipReason: string
}
export type ExtractionOutcome = IngestedDocument | SkippedDocument

// Count of non-whitespace characters, collapsing runs of whitespace — the measure of whether an
// extraction actually recovered a text layer rather than a page of blanks.
function readableLength(text: string): number {
  return text.replace(/\s+/g, ' ').trim().length
}

// Apply the per-doc cap. Named so the truncation is one obvious place, not an inline slice.
function capContent(text: string): string {
  return text.length > MAX_DOC_CONTENT_CHARS ? text.slice(0, MAX_DOC_CONTENT_CHARS) : text
}

// Turn already-authored text (a Google Doc export, or a DOCX's extracted text) into an ingested
// outcome: capped, always ingested. An empty authored doc is legitimately empty and simply
// grounds nothing — the skip-and-flag path is for a scan the system tried and failed to read,
// not for a document whose author left it (or a section of it) blank.
export function ingestAuthoredText(raw: string): IngestedDocument {
  return { status: 'ingested', content: capContent(raw), skipReason: null }
}

// Extract a text-layer PDF's text with pdf.js. A PDF with no recoverable text (scanned or
// image-only) comes back near-empty and is skipped-and-flagged rather than ingested as blank.
export async function extractPdf(bytes: Buffer): Promise<ExtractionOutcome> {
  // verbosity 0 silences pdf.js's font/worker warnings; a Uint8Array copy because pdf.js takes
  // ownership of and detaches the buffer it is given.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const doc = await loadingTask.promise
  try {
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
    }
    const text = pages.join('\n')
    if (readableLength(text) < MIN_READABLE_CHARS) {
      return { status: 'skipped', content: null, skipReason: SCANNED_PDF_SKIP_REASON }
    }
    return { status: 'ingested', content: capContent(text), skipReason: null }
  } finally {
    // Tear down the document and its worker so extraction leaves nothing running.
    await loadingTask.destroy()
  }
}

// Extract a Word document's text with mammoth. A DOCX is authored text like a Google Doc, so it
// is always ingested (capped) — not subject to the scanned-PDF skip. mammoth throws on a corrupt
// file; an empty extraction means an empty document, which ingests as empty and grounds nothing.
export async function extractDocx(bytes: Buffer): Promise<IngestedDocument> {
  const { value } = await mammoth.extractRawText({ buffer: bytes })
  return ingestAuthoredText(value)
}

// Extract an Excel workbook's cells as CSV text with SheetJS, every sheet, each under a line
// naming its tab — the tab name is often the only label for what a table is about (a week, a
// location), so grounding keeps it. Cells arrive formatted (dates and currency as displayed,
// a formula as its cached result), which is the text a reader of the spreadsheet would cite.
// An XLSX is authored content like a DOCX, so it is always ingested (capped); SheetJS throws
// on a file that is not actually a workbook.
export function extractXlsx(bytes: Buffer): IngestedDocument {
  const workbook = xlsx.read(bytes, { type: 'buffer' })
  const sheets = Object.entries(workbook.Sheets).map(
    ([name, sheet]) => `[sheet: ${name}]\n${xlsx.utils.sheet_to_csv(sheet, { blankrows: false })}`,
  )
  return ingestAuthoredText(sheets.join('\n\n'))
}
