import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { extractDocx, extractPptx } from '../src/assistant/document-extraction.js'

// The PPTX reader (2026-09 plan, phase 2): slide text straight from the zip's XML, in the deck's
// presentation order (which lives in presentation.xml's slide list, not in the slide file names).
// The element detector counts only DRAWN shapes — a slide's title/body placeholders are the text
// skeleton every deck has, so a bullet deck ingests as text while an org chart drawn as dozens of
// floating boxes lands in the same skipped-with-a-reason state the DOCX detector produces.

// --- a minimal PPTX builder: the parts the extractor reads ---

const presentationXml = (rIds: string[]): string => `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${rIds.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join('')}</p:sldIdLst>
</p:presentation>`

const presentationRels = (entries: Array<[string, string]>): string => `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${entries
  .map(
    ([id, target]) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}"/>`,
  )
  .join('\n')}
</Relationships>`

// A shape: a placeholder (title/body) carries <p:ph/>; a drawn box does not.
const slideShape = (text: string, opts: { placeholder?: string } = {}): string => `<p:sp>
  <p:nvSpPr><p:nvPr>${opts.placeholder ? `<p:ph type="${opts.placeholder}"/>` : ''}</p:nvPr></p:nvSpPr>
  <p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>
</p:sp>`

const slideXml = (shapes: string[]): string => `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld>
</p:sld>`

const buildPptx = async (
  slides: Array<{ file: string; shapes: string[] }>,
  order: Array<[rId: string, target: string]>,
): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file('ppt/presentation.xml', presentationXml(order.map(([id]) => id)))
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels(order))
  for (const slide of slides) {
    zip.file(`ppt/slides/${slide.file}`, slideXml(slide.shapes))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('extractPptx — slide text in presentation order', () => {
  it('reads a text deck as ingested content, slides marked and ordered by the slide list', async () => {
    // slide2.xml is listed FIRST in the presentation — filename order must not win.
    const bytes = await buildPptx(
      [
        {
          file: 'slide1.xml',
          shapes: [
            slideShape('סיכום החודש', { placeholder: 'title' }),
            slideShape(
              'המכירות עלו בעשרה אחוזים לעומת החודש הקודם בכל הסניפים ברשת, ' +
                'בעיקר בזכות מבצע ההשקה של המנה החדשה בתפריט.',
              { placeholder: 'body' },
            ),
          ],
        },
        {
          file: 'slide2.xml',
          shapes: [
            slideShape('פתיחה', { placeholder: 'title' }),
            slideShape('ברוכים הבאים לישיבת הרבעון של מטה הרשת.', { placeholder: 'body' }),
          ],
        },
      ],
      [
        ['rId2', 'slides/slide2.xml'],
        ['rId1', 'slides/slide1.xml'],
      ],
    )
    const outcome = await extractPptx(bytes)
    expect(outcome.status).toBe('ingested')
    if (outcome.status !== 'ingested') throw new Error('unreachable')
    expect(outcome.content).toContain('[slide 1]')
    expect(outcome.content).toContain('[slide 2]')
    // Presentation order: the deck opens with פתיחה (slide2.xml), then the summary.
    expect(outcome.content.indexOf('פתיחה')).toBeLessThan(outcome.content.indexOf('סיכום החודש'))
  })

  it('skips a deck of drawn boxes (an org chart) with the diagram reason and kind', async () => {
    const boxes = [
      'מנכ"ל',
      'סמנכ"ל תפעול',
      'סמנכ"ל כספים',
      'מנהלת שיווק',
      'מנהל רכש',
      'מנהל מוקד',
      'מנהלת משאבי אנוש',
      'מבקר פנים',
    ].map((t) => slideShape(t))
    const bytes = await buildPptx(
      [{ file: 'slide1.xml', shapes: boxes }],
      [['rId1', 'slides/slide1.xml']],
    )
    const outcome = await extractPptx(bytes)
    expect(outcome.status).toBe('skipped')
    if (outcome.status !== 'skipped') throw new Error('unreachable')
    expect(outcome.skipReason).toContain('iagram')
    expect(outcome.skipKind).toBe('diagram')
  })

  it('does not count title/body placeholders as drawn elements', async () => {
    // Ten slides of pure placeholder text: a real presentation, never a diagram.
    const slides = Array.from({ length: 10 }, (_, i) => ({
      file: `slide${i + 1}.xml`,
      shapes: [
        slideShape(`נושא ${i + 1}`, { placeholder: 'title' }),
        slideShape('תוכן קצר על הנושא הזה בכמה מילים בלבד.', { placeholder: 'body' }),
      ],
    }))
    const bytes = await buildPptx(
      slides,
      slides.map((s, i) => [`rId${i + 1}`, `slides/${s.file}`]),
    )
    const outcome = await extractPptx(bytes)
    expect(outcome.status).toBe('ingested')
  })
})

describe('the diagram skip carries its machine-readable kind', () => {
  it('marks a DOCX diagram skip as skipKind diagram', async () => {
    // Reuses the DOCX builder shape from element-detector.test.ts in minimal form.
    const zip = new JSZip()
    const box = (label: string) => `<w:p><w:r><mc:AlternateContent>
      <mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice>
      <mc:Fallback><w:pict><v:shape/></w:pict></mc:Fallback>
    </mc:AlternateContent></w:r></w:p>`
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
        xmlns:v="urn:schemas-microsoft-com:vml">
        <w:body>${['מנהלה', 'שיווק', 'כספים', 'רכש'].map(box).join('')}</w:body>
      </w:document>`,
    )
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
    const outcome = await extractDocx(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(outcome.status).toBe('skipped')
    if (outcome.status !== 'skipped') throw new Error('unreachable')
    expect(outcome.skipKind).toBe('diagram')
  })
})
