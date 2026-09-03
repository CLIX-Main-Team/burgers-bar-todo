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
  anchoredBox('', 8.5, 2.5, 'bentConnector3'),
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
    // The composed content keeps the document's own paragraph text and the model's output, with
    // no inline provenance marker — that used to be '[תמלול אוטומטי של התרשים]' and its words
    // joined every chunk's keyword statistics; provenance now rides the doc row instead.
    expect(result.content).toContain('מבנה ארגוני')
    expect(result.content).not.toContain('[תמלול אוטומטי')
    expect(result.content).toContain('מנהל תפעול כפוף למנהלת רשת.')

    // The prompt carried every box label verbatim, its position, and the connector's kind — and
    // with a REAL connector drawn, the model is asked for asserted reporting lines.
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(prompt).toContain('מנהלת רשת')
    expect(prompt).toContain('מנהלת כספים')
    expect(prompt).toContain('bentConnector3')
    expect(prompt).toContain('x=8')
    expect(prompt).toContain('כתוב את ההיררכיה במשפטים מלאים')
    // Geometry goes as text; the chart call must not attach images.
    expect(llm.requests[0]?.images).toBeUndefined()
    // Boxes are listed in reading order: the top box before the lower ones.
    expect(prompt.indexOf('מנהלת רשת')).toBeLessThan(prompt.indexOf('מנהל תפעול'))
    // The completion budget scales with the chart (floor for small ones): the first prod run cut
    // every mid-sized chart off at a fixed 1,200 — reasoning spends inside the same budget on the
    // Pro model, and Hebrew hierarchy sentences are token-dense.
    expect(llm.requests[0]?.maxTokens).toBe(3000)
  })

  it('describes layout only, forbidding any subordination language, when nothing connects the boxes', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer(FULL_TRANSCRIPTION)
    const transcriber = createVisualTranscriber({ llm })

    // The same chart minus its connector — the shape of the prod charts whose reporting lines
    // came out wrong. The v2 lesson (verified against the reloaded corpus): even a hedged
    // direction guess leads with the wrong claim, so with no connector the model may not use
    // subordination or seniority wording at all — layout description only.
    const result = await transcriber.transcribe({
      title: 'מבנה מחלקה.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(
        [
          anchoredBox('מנהלת רשת', 8, 1),
          anchoredBox('מנהל תפעול', 4, 4),
          anchoredBox('מנהלת כספים', 12, 4),
        ].join(''),
      ),
    })

    expect(result.ok).toBe(true)
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(prompt).toContain('לא צוירו קווי חיבור')
    expect(prompt).toContain('אל תכתוב יחסי כפיפות')
    expect(prompt).not.toContain('כתוב את ההיררכיה במשפטים מלאים')
    // No hedged-direction template either — v2's "ייתכן ש-X כפוף ל-Y" still spread wrong edges.
    expect(prompt).not.toContain('ייתכן')
  })

  it('ignores geometry AND connectors when boxes are paragraph-anchored, listing by document order', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer(
      'מבנה מחלקת מוקד. במסמך מופיעות התיבות: מנהל מוקד, מנהלת רשת, נציגי שירות.',
    )
    const transcriber = createVisualTranscriber({ llm })

    // Word's default: floating boxes anchored to their own PARAGRAPHS, so each box's offsets
    // live in a different coordinate space (the real מוקד chart — two peers read as three
    // tiers). Connector coordinates are equally unanchored, so even a drawn line cannot be
    // resolved to endpoints: nothing licenses structure claims here.
    const paragraphAnchored = (label: string, xCm: number, yCm: number, prst = 'rect') =>
      anchoredBox(label, xCm, yCm, prst).replace(
        '<wp:positionV relativeFrom="page">',
        '<wp:positionV relativeFrom="paragraph">',
      )
    const result = await transcriber.transcribe({
      title: 'מבנה מחלקת מוקד.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(
        [
          // Document order: מנהל מוקד first despite the LARGER fake y — untrusted geometry must
          // not reorder the listing.
          paragraphAnchored('מנהל מוקד', 8, 9),
          paragraphAnchored('מנהלת רשת', 4, 1),
          paragraphAnchored('נציגי שירות', 12, 4),
          paragraphAnchored('', 8.5, 2.5, 'straightConnector1'),
        ].join(''),
      ),
    })

    expect(result.ok).toBe(true)
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    // No coordinates shown, no hierarchy instruction (despite the real connector), an explicit
    // prohibition instead, and the boxes keep their document order.
    expect(prompt).not.toContain('x=')
    expect(prompt).not.toContain('כתוב את ההיררכיה במשפטים מלאים')
    expect(prompt).toContain('אל תכתוב יחסי כפיפות')
    expect(prompt.indexOf('מנהל מוקד')).toBeLessThan(prompt.indexOf('מנהלת רשת'))
  })

  it('rejects structure claims the model makes anyway over untrusted geometry', async () => {
    const llm = createFakeLlmClient()
    let calls = 0
    llm.respondWith(() => {
      calls += 1
      // First attempt disobeys the prohibition; the retry complies.
      return calls === 1
        ? { ok: true, content: 'מנהל מוקד בראש; מנהלת רשת כפופה לו; נציגי שירות בדרג התחתון.' }
        : { ok: true, content: 'במסמך מופיעות התיבות: מנהל מוקד, מנהלת רשת, נציגי שירות.' }
    })
    const transcriber = createVisualTranscriber({ llm })

    const paragraphAnchored = (label: string, xCm: number, yCm: number) =>
      anchoredBox(label, xCm, yCm).replace(
        '<wp:positionV relativeFrom="page">',
        '<wp:positionV relativeFrom="paragraph">',
      )
    const result = await transcriber.transcribe({
      title: 'מבנה מחלקת מוקד.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(
        [
          paragraphAnchored('מנהל מוקד', 8, 1),
          paragraphAnchored('מנהלת רשת', 4, 4),
          paragraphAnchored('נציגי שירות', 12, 4),
        ].join(''),
      ),
    })

    // The deterministic gate caught the subordination wording, retried once, and kept the
    // compliant answer — never the invented tiers.
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.content).not.toContain('כפופה')
  })

  it('treats a block-arrow glyph as decoration, not as a connector', async () => {
    const llm = createFakeLlmClient()
    llm.setDefaultAnswer(
      'מבנה מחלקת מוקד: בחלק העליון מנהל מוקד, ומתחתיו מנהל מוקד שני לצד נציגי שירות.',
    )
    const transcriber = createVisualTranscriber({ llm })

    // The מוקד case: downArrow shapes drawn between tiers are decoration in this corpus and do
    // not encode reporting lines — the chart still reads layout-only.
    const result = await transcriber.transcribe({
      title: 'מבנה מחלקת מוקד.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(
        [
          anchoredBox('מנהל מוקד', 8, 1),
          anchoredBox('מנהל מוקד שני', 4, 4),
          anchoredBox('נציגי שירות', 12, 4),
          anchoredBox('', 8.5, 2.5, 'downArrow'),
        ].join(''),
      ),
    })

    expect(result.ok).toBe(true)
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(prompt).toContain('לא צוירו קווי חיבור')
    expect(prompt).not.toContain('כתוב את ההיררכיה במשפטים מלאים')
  })

  it('tells the model when the boxes carry no usable geometry at all', async () => {
    const llm = createFakeLlmClient()
    // A compliant listing: the forbidden-structure gate now applies here too, so the fake's
    // answer must carry every label without any subordination wording.
    llm.setDefaultAnswer('מבנה: במסמך מופיעות התיבות מנהלת רשת, מנהל תפעול, מנהלת כספים.')
    const transcriber = createVisualTranscriber({ llm })

    // Inline-anchored boxes have no position offsets, so the harvest places them all at (0,0):
    // y says nothing, and a levels claim from it would be as wrong as an edge claim.
    const unplacedBox = (label: string): string => `
      <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>
        <wp:anchor>
          <wp:extent cx="${4 * EMU_PER_CM}" cy="${1 * EMU_PER_CM}"/>
          <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr>
            <wps:txbx><w:txbxContent><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:txbxContent></wps:txbx>
            </wps:wsp>
          </a:graphicData></a:graphic>
        </wp:anchor>
      </w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape/></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`
    const result = await transcriber.transcribe({
      title: 'chart.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(
        [unplacedBox('מנהלת רשת'), unplacedBox('מנהל תפעול'), unplacedBox('מנהלת כספים')].join(''),
      ),
    })

    expect(result.ok).toBe(true)
    const prompt = llm.requests[0]?.messages.map((m) => m.content).join('\n') ?? ''
    expect(prompt).toContain('אין נתוני מיקום אמינים')
    expect(prompt).toContain('אל תכתוב יחסי כפיפות')
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
    expect(visionCalls[0]?.maxTokens).toBe(600)
    // The describe prompt carries surrounding document text as context.
    expect(visionCalls[0]?.messages.map((m) => m.content).join('\n')).toContain('זסטר')
  })

  it('drops images the model classifies as junk, and keeps the numbering gapless', async () => {
    const llm = createFakeLlmClient()
    let imageCalls = 0
    llm.respondWith((request) => {
      if (!request.images) return { ok: true, content: 'לא רלוונטי' }
      imageCalls += 1
      // The first image is the letterhead logo — the classification rule in the prompt tells the
      // model to answer with the sentinel alone; the second is a real screenshot.
      return imageCalls === 1
        ? { ok: true, content: 'JUNK' }
        : { ok: true, content: 'מסך ההזמנות בתוכנת זסטר עם כפתור "אישור".' }
    })
    const transcriber = createVisualTranscriber({ llm })

    const image = () => Buffer.alloc(MIN_DESCRIBABLE_IMAGE_BYTES + 10, 7)
    const result = await transcriber.transcribe({
      title: 'נוהל זסטר.docx',
      mimeType: DOCX_MIME,
      bytes: await buildDocx(paragraph('נוהל עבודה בתוכנת זסטר.'), [
        ['image1.png', image()],
        ['image2.png', image()],
      ]),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    // The junk description never lands in the content, and the surviving one is [תמונה 1] —
    // numbering counts kept descriptions, not model calls.
    expect(result.content).not.toContain('JUNK')
    expect(result.content).toContain('[תמונה 1] מסך ההזמנות')
    expect(result.content).not.toContain('[תמונה 2]')
    // The prompt carries the classification rule that makes the sentinel possible.
    const visionPrompt = llm.requests
      .find((r) => r.images !== undefined)
      ?.messages.map((m) => m.content)
      .join('\n')
    expect(visionPrompt).toContain('JUNK')
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
