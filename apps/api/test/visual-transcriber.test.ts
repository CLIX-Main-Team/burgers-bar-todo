import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { createFakeLlmClient } from '../src/assistant/llm-client.js'
import {
  MIN_DESCRIBABLE_IMAGE_BYTES,
  createVisualTranscriber,
} from '../src/assistant/visual-transcriber.js'

// The visual transcriber (2026-09 plan, phase 2): a diagram-flagged document becomes real
// indexable text by handing a text model the harvested boxes WITH their geometry (never a
// rendered page), and the vision model only ever sees actual raster images (the
// screenshot-procedure class). Anti-miss discipline from the design research: models miss boxes
// far more than they invent them, so every harvested label must appear in the transcription —
// checked deterministically, one corrective retry, then an honest failure that leaves the
// document in its flagged state.

const EMU_PER_CM = 360000

const anchoredBox = (label: string, xCm: number, yCm: number, prst = 'rect'): string => `
<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>
  <wp:anchor>
    <wp:positionH relativeFrom="page"><wp:posOffset>${xCm * EMU_PER_CM}</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="page"><wp:posOffset>${yCm * EMU_PER_CM}</wp:posOffset></wp:positionV>
    <wp:extent cx="${4 * EMU_PER_CM}" cy="${1 * EMU_PER_CM}"/>
    <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
      <wps:wsp><wps:spPr><a:prstGeom prst="${prst}"/></wps:spPr>
      ${label === '' ? '' : `<wps:txbx><w:txbxContent><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:txbxContent></wps:txbx>`}
      </wps:wsp>
    </a:graphicData></a:graphic>
  </wp:anchor>
</w:drawing></mc:Choice>
<mc:Fallback><w:pict><v:shape/></w:pict></mc:Fallback>
</mc:AlternateContent></w:r></w:p>`

const paragraph = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

const buildDocx = async (
  body: string,
  media: Array<[name: string, bytes: Buffer]> = [],
): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="png" ContentType="image/png"/>
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
      <w:body>${body}</w:body>
    </w:document>`,
  )
  for (const [name, bytes] of media) {
    zip.file(`word/media/${name}`, bytes)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const CHART_BODY = [
  paragraph('מבנה ארגוני'),
  anchoredBox('מנהלת רשת', 8, 1),
  anchoredBox('מנהל תפעול', 4, 4),
  anchoredBox('מנהלת כספים', 12, 4),
  anchoredBox('', 8.5, 2.5, 'downArrow'),
].join('')

const FULL_TRANSCRIPTION = [
  'מבנה הרשת:',
  'מנהלת רשת עומדת בראש המבנה.',
  'מנהל תפעול כפוף למנהלת רשת.',
  'מנהלת כספים כפופה למנהלת רשת.',
].join('\n')

describe('createVisualTranscriber — the chart path', () => {
  it('feeds every harvested box with its geometry to the model and composes the content', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer(FULL_TRANSCRIPTION)
    const transcriber = createVisualTranscriber({ llm })

    const result = await transcriber.transcribe({
      title: 'מבנה אירגוני.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(CHART_BODY),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // The composed content keeps the document's own paragraph text, marks the transcription as
    // automatic, and carries the model's output.
    expect(result.content).toContain('מבנה ארגוני')
    expect(result.content).toContain('[תמלול אוטומטי')
    expect(result.content).toContain('מנהל תפעול כפוף למנהלת רשת.')

    // The prompt carried every box label verbatim, its position, and the arrow's kind.
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(prompt).toContain('מנהלת רשת')
    expect(prompt).toContain('מנהלת כספים')
    expect(prompt).toContain('downArrow')
    expect(prompt).toContain('x=8')
    // Geometry goes as text; the chart call must not attach images.
    expect(llm.requests[0]?.images).toBeUndefined()
    // Boxes are listed in reading order: the top box before the lower ones.
    expect(prompt.indexOf('מנהלת רשת')).toBeLessThan(prompt.indexOf('מנהל תפעול'))
  })

  it('retries once naming the missing boxes, then fails honestly if a label is still missing', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      // Both attempts omit מנהלת כספים — the anti-miss validator must reject both.
      return { ok: true, content: 'מנהלת רשת עומדת בראש. מנהל תפעול כפוף לה.' }
    })
    const transcriber = createVisualTranscriber({ llm })

    const result = await transcriber.transcribe({
      title: 'chart.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(CHART_BODY),
    })

    expect(calls).toBe(2)
    expect(result.ok).toBe(false)
    // The corrective retry told the model which boxes it lost.
    const retryPrompt = llm.requests[1]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(retryPrompt).toContain('מנהלת כספים')
  })

  it('rejects reversed-bidi output (final letters starting words) via the same retry gate', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      if (calls === 1) {
        // A reversed rendering: every word begins with a final letter — the classic RTL mangling.
        return { ok: true, content: 'תשר תלהנמ / םיפסכ תלהנמ / לועפת להנמ' }
      }
      return { ok: true, content: FULL_TRANSCRIPTION }
    })
    const transcriber = createVisualTranscriber({ llm })

    const result = await transcriber.transcribe({
      title: 'chart.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(CHART_BODY),
    })

    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
  })

  it('folds a provider failure into an honest failure, never a fabricated transcription', async () => {
    const llm = createFakeLlmClient()
    llm.failNext('provider responded 402')
    const transcriber = createVisualTranscriber({ llm })

    const result = await transcriber.transcribe({
      title: 'chart.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(CHART_BODY),
    })

    expect(result).toMatchObject({ ok: false })
  })
})

describe('createVisualTranscriber — the screenshot path', () => {
  it('describes each real screenshot with the vision model and skips junk-sized images', async () => {
    const llm = createFakeLlmClient()
    llm.respondWith((request) =>
      request.images
        ? { ok: true, content: 'מסך הכניסה לתוכנת זסטר עם כפתור "התחברות".' }
        : { ok: true, content: 'לא רלוונטי' },
    )
    const transcriber = createVisualTranscriber({ llm })

    const screenshot = Buffer.alloc(MIN_DESCRIBABLE_IMAGE_BYTES + 10, 7)
    const tinyLogo = Buffer.alloc(200, 7)
    // Two arrow callouts only — not enough labeled boxes for a chart call, so the model is
    // reached exclusively through the vision path.
    const body = [
      paragraph('נוהל כניסה לתוכנת זסטר. יש להיכנס עם שם המשתמש של הסניף.'),
      anchoredBox('', 2, 2, 'rightArrow'),
      anchoredBox('', 3, 3, 'rightArrow'),
      anchoredBox('', 4, 4, 'rightArrow'),
    ].join('')
    const result = await transcriber.transcribe({
      title: 'נוהל זסטר.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(body, [
        ['image1.png', screenshot],
        ['logo.png', tinyLogo],
      ]),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).toContain('כפתור "התחברות"')
    expect(result.content).toContain('[תמונה 1]')
    // Exactly one vision call: the real screenshot; the junk-sized logo never reached the model.
    const visionCalls = llm.requests.filter((r) => r.images !== undefined)
    expect(visionCalls).toHaveLength(1)
    expect(visionCalls[0]?.images?.[0]).toContain('data:image/png;base64,')
    // The describe prompt carries surrounding document text as context.
    expect(visionCalls[0]?.messages.map((m) => m.content).join('\n')).toContain('זסטר')
  })

  it('fails when the document offers nothing transcribable at all', async () => {
    const llm = createFakeLlmClient()
    const transcriber = createVisualTranscriber({ llm })
    const result = await transcriber.transcribe({
      title: 'empty.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(paragraph('רק טקסט קצר.')),
    })
    expect(result).toMatchObject({ ok: false })
    expect(llm.requests).toHaveLength(0)
  })
})
