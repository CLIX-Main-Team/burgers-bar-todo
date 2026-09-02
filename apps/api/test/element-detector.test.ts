import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  extractDocx,
  extractHtml,
  isDiagramHeavy,
  pdfLooksVisual,
} from '../src/assistant/document-extraction.js'

// The element detector (2026-09 plan, phase 1): a document whose meaning lives in drawn shapes
// and images must not be indexed as the scrambled bag of labels text extraction reduces it to —
// an org chart's floating names invite the model to invent reporting lines, which is worse than
// the document being absent. Detection is deterministic counting, no AI: elements versus real
// text, per format (Excel exempt — its substance is the cell data we already extract). Flagged
// documents land in the same skipped-with-a-reason state scanned PDFs already use, visible in
// the admin Knowledge tab.

// --- a minimal DOCX builder: a real zip with the parts mammoth needs ---

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const documentXml = (
  body: string,
): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  xmlns:v="urn:schemas-microsoft-com:vml"
  mc:Ignorable="wps">
  <w:body>${body}</w:body>
</w:document>`

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

// A drawn text-box shape the way Word writes one: an AlternateContent block whose Choice carries
// the DrawingML shape and whose Fallback carries the VML twin — one shape, written twice.
const shapeBox = (label: string): string => `<w:p><w:r><mc:AlternateContent>
  <mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>${paragraph(label)}</w:txbxContent></wps:txbx></w:drawing></mc:Choice>
  <mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${paragraph(label)}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>
</mc:AlternateContent></w:r></w:p>`

const buildDocx = async (body: string, mediaFiles = 0): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', ROOT_RELS)
  zip.file('word/document.xml', documentXml(body))
  for (let i = 1; i <= mediaFiles; i += 1) {
    zip.file(`word/media/image${i}.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('the diagram-heaviness rule', () => {
  it('flags many elements with little text, and spares both a few images and a real document', () => {
    // An org chart: dozens of boxes, each holding a job title.
    expect(isDiagramHeavy(12, 400)).toBe(true)
    // Two screenshots never flag a document on their own, whatever its length.
    expect(isDiagramHeavy(2, 50)).toBe(false)
    // A procedure with several screenshots and real prose keeps flowing.
    expect(isDiagramHeavy(5, 1800)).toBe(false)
  })
})

describe('extractDocx — the element detector', () => {
  it('skips a Word file that is mostly drawn shapes, naming the reason for the admin tab', async () => {
    const labels = ['מנהלה', 'שיווק', 'כספים', 'רכש', 'תפעול', 'מוקד הזמנות']
    const bytes = await buildDocx(labels.map(shapeBox).join(''))
    const outcome = await extractDocx(bytes)
    expect(outcome.status).toBe('skipped')
    expect(outcome.skipReason).toContain('iagram')
  })

  it('keeps ingesting a real procedure that happens to carry a few screenshots', async () => {
    const prose = paragraph(
      'כדי לבצע הזמנה יש להיכנס לאתר, ללחוץ על כפתור הזמנות בצד שמאל, לבחור את הספק הרלוונטי, ' +
        'לסמן את המוצרים הדרושים ולהוסיף הערות לספק במידת הצורך. לאחר מכן ההזמנה מוכנה לשליחה. ' +
        'יש ללחוץ על כפתור שלח מצד ימין מעל ההזמנה ולוודא שהתקבל אישור. ' +
        'במקרה של תקלה יש לפנות למנהל הסניף או למשרד הראשי בטלפון המופיע בתחתית המסך.',
    )
    const bytes = await buildDocx(prose.repeat(3), 2)
    const outcome = await extractDocx(bytes)
    expect(outcome.status).toBe('ingested')
    expect(outcome.content).toContain('כפתור שלח')
  })
})

describe('extractHtml — the element detector', () => {
  it('skips a page of images with no text', () => {
    const html = `<html><body>
      <img src="a.png"/><img src="b.png"/><img src="c.png"/><img src="d.png"/>
      <p>תרשים</p>
    </body></html>`
    const outcome = extractHtml(Buffer.from(html, 'utf8'))
    expect(outcome.status).toBe('skipped')
    expect(outcome.skipReason).toContain('iagram')
  })

  it('keeps an image-rich page whose substance is text or embedded data', () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `<tr><td>סניף מספר ${i} ברשת</td><td>הכנסות החודש: ${i * 1000} שקלים</td></tr>`,
    )
    const html = `<html><body>
      <img src="logo.png"/><img src="banner.png"/><img src="chart.png"/>
      <table>${rows.join('')}</table>
    </body></html>`
    const outcome = extractHtml(Buffer.from(html, 'utf8'))
    expect(outcome.status).toBe('ingested')
  })
})

describe('pdfLooksVisual — the per-page verdict', () => {
  it('flags a document whose pages are mostly images with stray text', () => {
    expect(
      pdfLooksVisual([
        { readableChars: 40, imageOps: 2 },
        { readableChars: 12, imageOps: 1 },
      ]),
    ).toBe(true)
  })

  it('spares a text document with an illustrated cover page', () => {
    expect(
      pdfLooksVisual([
        { readableChars: 30, imageOps: 1 },
        { readableChars: 1400, imageOps: 0 },
        { readableChars: 1600, imageOps: 1 },
      ]),
    ).toBe(false)
  })

  it('never flags on images alone when every page carries real text', () => {
    expect(
      pdfLooksVisual([
        { readableChars: 900, imageOps: 3 },
        { readableChars: 800, imageOps: 2 },
      ]),
    ).toBe(false)
  })
})
