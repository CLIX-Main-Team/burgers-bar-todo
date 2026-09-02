import JSZip from 'jszip'
import mammoth from 'mammoth'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as xlsx from 'xlsx'

// Text extraction for the non-Doc corpus formats (#88): a text-layer PDF (pdf.js), a Word
// document (mammoth), an Excel workbook (SheetJS), and an HTML page become plain text the
// knowledge cache can ground on. This module is pure —
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
export const HTML_MIME_TYPE = 'text/html'

// The per-doc content cap, and a runaway guard rather than a prompt budget.
//
// It used to be 20,000 characters, justified by grounding concatenating whole cached documents into
// the prompt. That stopped being true with ADR-0025: grounding now selects individual chunks within
// a token budget, so a long document contributes only its selected chunks and the prompt is bounded
// whatever the document's length. What the old cap actually did was delete text — mid-word, with no
// marker, no flag, and no log, while the admin view reported the document as ingested. For an XLSX
// it was worse: the sheets are joined before the cap is applied, so trailing sheets vanished whole,
// and an append-style workbook loses its NEWEST rows that way.
//
// What is left is a bound on one pathological file, because chunking a document costs a premium gist
// completion and an embedding per chunk, so a multi-megabyte export dropped in Drive is a real bill.
// 200,000 characters sits far above any procedure, recipe, or checklist this corpus holds and well
// under that. When it does bite it cuts at a word boundary and says so in the text, the way the task
// block already announces its own truncation, so the model never reports a partial document as
// complete and an admin reading the document can see where it stops.
export const MAX_DOC_CONTENT_CHARS = 200_000

// Appended to a document the cap truncated. In the text itself, because the content column is the
// only channel that reaches both the model and the admin view.
export const CONTENT_TRUNCATION_NOTICE = [
  '',
  '',
  '[This document was too long to ingest in full. The text above is its beginning only;',
  'the rest was not indexed.]',
].join('\n')

// Below this many non-whitespace characters, an extraction counts as "no readable text layer":
// a scanned or image-only PDF yields zero, and a handful of stray glyphs is still not a document
// worth grounding on. This is the line between ingested and skipped-and-flagged.
const MIN_READABLE_CHARS = 16

// The reason an admin sees for a skipped doc. Phrased as what happened and why, since it
// surfaces on the admin knowledge view as the explanation for a doc that grounds nothing.
export const SCANNED_PDF_SKIP_REASON =
  'Scanned or image-only PDF: no extractable text layer (OCR is not supported).'

// --- The element detector (2026-09 plan, phase 1) ---
//
// A document whose meaning lives in drawn shapes and images (an org chart, a flowchart) reduces
// under text extraction to a bag of floating labels in arbitrary order — and a bag of names is
// worse than absence, because the model will confidently infer relationships from adjacency the
// layout never asserted. So element-heavy documents are skipped-and-flagged like scanned PDFs,
// never indexed as fragments; the reason tells the admin what the document needs (a text version
// today; the vision-transcription step when it exists). Detection is deterministic counting —
// the routing rule the commercial parsers use ("any image on the page", "text layer extractable")
// sharpened with a text-per-element guard so an illustrated procedure keeps flowing. Excel is
// exempt by design: a workbook's substance is its cell data, which extraction already captures.

// Below this many elements a document can never be flagged — two screenshots are illustration,
// not a diagram.
export const DIAGRAM_MIN_ELEMENTS = 3
// And above this much readable text per element, the words are the substance and the images ride
// along. An org chart runs a handful of characters per box; a procedure with screenshots runs
// hundreds per image.
export const DIAGRAM_CHARS_PER_ELEMENT = 200

export function isDiagramHeavy(elements: number, readableChars: number): boolean {
  return elements >= DIAGRAM_MIN_ELEMENTS && readableChars < elements * DIAGRAM_CHARS_PER_ELEMENT
}

export function diagramSkipReason(elements: number, readableChars: number): string {
  return (
    `Diagram-heavy document: ${elements} drawn elements/images against ${readableChars} characters ` +
    'of text. The layout carries the meaning, which text extraction loses, so it is not indexed ' +
    'as fragments — add a text version of this content for the assistant.'
  )
}

// A PDF page is "visual" when it carries images but almost no text. The document is flagged when
// MOST pages are visual: a text document with an illustrated cover keeps flowing, and a document
// that is wholly image pages was already caught by the scanned-PDF check before this runs.
const VISUAL_PAGE_MAX_CHARS = 100

export interface PdfPageStats {
  readableChars: number
  imageOps: number
}

export function pdfLooksVisual(pages: PdfPageStats[]): boolean {
  if (pages.length === 0) return false
  const visual = pages.filter(
    (page) => page.imageOps > 0 && page.readableChars < VISUAL_PAGE_MAX_CHARS,
  ).length
  return visual > pages.length / 2
}

// Count a DOCX's drawn elements straight from the zip: embedded images are the files under
// word/media/, and shapes are counted from document.xml's markup. Word writes a shape twice — a
// DrawingML Choice plus a VML Fallback inside one mc:AlternateContent block — so the block is
// counted once; legacy VML pictures (w:pict outside a fallback) and SmartArt graphicData are the
// other shape spellings. mammoth sees none of these (shapes and SmartArt are silently dropped,
// charts without even a warning), which is exactly why the count comes from the XML and not from
// the extraction. Best-effort by design: a file mammoth could read but this walk cannot reads as
// zero elements and simply is not flagged.
async function countDocxElements(bytes: Buffer): Promise<number> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const media = Object.keys(zip.files).filter(
      (name) => name.startsWith('word/media/') && !zip.files[name]?.dir,
    ).length
    const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
    const shapes = (xml.match(/<mc:AlternateContent[\s>]/g) ?? []).length
    const fallbackPictures = (xml.match(/<mc:Fallback[\s>]/g) ?? []).length
    // w:pict inside a Fallback is the same shape as its Choice twin; only count strays.
    const legacyPictures = Math.max((xml.match(/<w:pict[\s>]/g) ?? []).length - fallbackPictures, 0)
    const smartArt = (
      xml.match(/uri="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/diagram"/g) ?? []
    ).length
    return media + shapes + legacyPictures + smartArt
  } catch {
    return 0
  }
}

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

// Apply the per-doc cap. Named so the truncation is one obvious place, not an inline slice. Cuts at
// the last whitespace before the limit rather than mid-word, and marks what it did.
function capContent(text: string): string {
  if (text.length <= MAX_DOC_CONTENT_CHARS) {
    return text
  }
  const boundary = text.lastIndexOf(' ', MAX_DOC_CONTENT_CHARS)
  // Fall back to the hard limit for text with no whitespace anywhere near it (a single enormous
  // token), where hunting for a boundary would throw away most of the document.
  const cut = boundary > MAX_DOC_CONTENT_CHARS * 0.9 ? boundary : MAX_DOC_CONTENT_CHARS
  return text.slice(0, cut) + CONTENT_TRUNCATION_NOTICE
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
    const pageStats: PdfPageStats[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
      pages.push(pageText)
      // The page's paint operations, for the element detector: how many image draws the page
      // carries, next to how much text it yielded.
      const ops = await page.getOperatorList()
      const imageOps = ops.fnArray.filter(
        (fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject,
      ).length
      pageStats.push({ readableChars: readableLength(pageText), imageOps })
    }
    const text = pages.join('\n')
    if (readableLength(text) < MIN_READABLE_CHARS) {
      return { status: 'skipped', content: null, skipReason: SCANNED_PDF_SKIP_REASON }
    }
    if (pdfLooksVisual(pageStats)) {
      const elements = pageStats.reduce((sum, page) => sum + page.imageOps, 0)
      return {
        status: 'skipped',
        content: null,
        skipReason: diagramSkipReason(elements, readableLength(text)),
      }
    }
    return { status: 'ingested', content: capContent(text), skipReason: null }
  } finally {
    // Tear down the document and its worker so extraction leaves nothing running.
    await loadingTask.destroy()
  }
}

// Extract a Word document's text with mammoth, unless the element detector says the text is not
// the document: a file of drawn shapes with only label-length text is skipped-and-flagged, since
// what mammoth returns for it is the org-chart fragment bag. mammoth throws on a corrupt file; an
// empty extraction with no elements means an empty document, which ingests and grounds nothing.
export async function extractDocx(bytes: Buffer): Promise<ExtractionOutcome> {
  const { value } = await mammoth.extractRawText({ buffer: bytes })
  const elements = await countDocxElements(bytes)
  const chars = readableLength(value)
  if (isDiagramHeavy(elements, chars)) {
    return { status: 'skipped', content: null, skipReason: diagramSkipReason(elements, chars) }
  }
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

// The named character entities worth decoding in extracted text. The numeric forms
// (&#123; / &#x1F4A9;) are handled generically; beyond these, an unknown entity is left as-is —
// visible-but-odd beats silently dropped.
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => HTML_ENTITIES[name.toLowerCase()] ?? whole)
}

// The page's rendered text: scripts and styles dropped whole, block-closing tags kept as line
// breaks so headings and table rows stay on their own lines, every other tag a space. A regex
// strip, not a DOM — the corpus pages are machine-exported reports, and for grounding text the
// worst a malformed page costs is a stray angle bracket, never an exception.
function htmlVisibleText(html: string): string {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(stripped)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}

// Slice one balanced [...] or {...} literal starting at `start`, honouring JSON string escapes.
// Both bracket kinds count toward one depth — a mismatched pair produces a slice JSON.parse
// rejects, which the caller already treats as "not data".
function balancedJsonLiteral(source: string, start: number): string | null {
  let depth = 0
  let inString = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

// Flatten a parsed data value to reader-facing lines: an object becomes one "key: value" line of
// its primitive fields with nested arrays indented beneath it, so a record and its sub-items read
// like an outline. Empty strings, nulls, and explicit `false` say nothing and are dropped.
function renderDataValue(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => renderDataValue(item, indent))
      .filter((line) => line !== '')
      .join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const fields: string[] = []
    const nested: string[] = []
    for (const [key, item] of Object.entries(value)) {
      if (item === null || item === '' || item === false) continue
      if (typeof item === 'object') {
        const inner = renderDataValue(item, `${indent}  `)
        if (inner !== '') nested.push(inner)
      } else {
        fields.push(`${key}: ${String(item).replace(/\s*\n\s*/g, ' / ')}`)
      }
    }
    const line = fields.length > 0 ? `${indent}${fields.join(' | ')}` : ''
    return [line, ...nested].filter((entry) => entry !== '').join('\n')
  }
  return typeof value === 'string' ? `${indent}${value}` : ''
}

// The data a script-rendered page would have shown: every `= [...]` / `= {...}` assignment in a
// <script> block that parses as strict JSON, flattened to lines. The corpus's dashboard exports
// keep their entire content in such arrays and render them client-side, so their visible markup
// is an empty shell — without this pass the page extracts to chrome labels and nothing else.
// Best-effort by construction: a literal that is JS-but-not-JSON (unquoted keys, single quotes)
// fails JSON.parse and is simply not data.
function htmlEmbeddedData(html: string): string {
  const blocks: string[] = []
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = script[1] ?? ''
    // Resume after each parsed literal so the objects inside it are not re-matched as their own
    // blocks; 50 chars keeps trivial state initialisers ({} and friends) out.
    let cursor = 0
    for (const match of body.matchAll(/=\s*([[{])/g)) {
      const start = (match.index ?? 0) + match[0].length - 1
      if (start < cursor) continue
      const literal = balancedJsonLiteral(body, start)
      if (literal === null || literal.length < 50) continue
      try {
        const rendered = renderDataValue(JSON.parse(literal))
        if (rendered !== '') blocks.push(rendered)
        cursor = start + literal.length
      } catch {}
    }
  }
  return blocks.join('\n\n')
}

// Extract an HTML page's text: the rendered markup text, plus — under a `[data]` marker, cousin
// to the XLSX `[sheet: ...]` convention — any JSON data arrays embedded in its scripts. A page
// that is images with next to no text or data is the diagram case and is skipped-and-flagged;
// otherwise an HTML file is authored content like a DOCX and always ingests (capped) — a page
// with neither text nor data nor images ingests as empty and grounds nothing.
export function extractHtml(bytes: Buffer): ExtractionOutcome {
  const html = bytes.toString('utf8')
  const text = htmlVisibleText(html)
  const data = htmlEmbeddedData(html)
  const combined = data === '' ? text : `${text}\n\n[data]\n${data}`
  const images = (html.match(/<img[\s/>]/gi) ?? []).length
  const chars = readableLength(combined)
  if (isDiagramHeavy(images, chars)) {
    return { status: 'skipped', content: null, skipReason: diagramSkipReason(images, chars) }
  }
  return ingestAuthoredText(combined)
}
