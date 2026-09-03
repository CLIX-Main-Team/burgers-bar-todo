import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { harvestDocx, harvestPptx } from '../src/assistant/shape-harvest.js'

// The shape harvester (2026-09 plan, phase 2): a diagram-flagged document's drawn boxes carry
// their labels and their page positions right in the OOXML — the org charts this corpus holds
// use no SmartArt and no connectors (verified against the real files), just floating text boxes
// laid out visually. Harvesting text + geometry is what lets a text model reconstruct the
// hierarchy without any page rendering. Raster media (the screenshot class) is collected for the
// vision path; vector media (emf/wmf) is not — nothing here can rasterize it.

// --- builders ---

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
<mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback>
</mc:AlternateContent></w:r></w:p>`

const buildDocx = async (
  body: string,
  media: Array<[name: string, bytes: Buffer]> = [],
  documentRels?: string,
): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
      xmlns:v="urn:schemas-microsoft-com:vml">
      <w:body>${body}</w:body>
    </w:document>`,
  )
  if (documentRels !== undefined) {
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${documentRels}</Relationships>`,
    )
  }
  for (const [name, bytes] of media) {
    zip.file(`word/media/${name}`, bytes)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

const pptxShape = (label: string, xCm: number, yCm: number, prst = 'rect'): string => `<p:sp>
  <p:spPr><a:xfrm><a:off x="${xCm * EMU_PER_CM}" y="${yCm * EMU_PER_CM}"/><a:ext cx="${3 * EMU_PER_CM}" cy="${1 * EMU_PER_CM}"/></a:xfrm>
  <a:prstGeom prst="${prst}"/></p:spPr>
  ${label === '' ? '' : `<p:txBody><a:p><a:r><a:t>${label}</a:t></a:r></a:p></p:txBody>`}
</p:sp>`

const pptxConnector = (xCm: number, yCm: number, prst: string): string => `<p:cxnSp>
  <p:spPr><a:xfrm><a:off x="${xCm * EMU_PER_CM}" y="${yCm * EMU_PER_CM}"/><a:ext cx="${EMU_PER_CM}" cy="${EMU_PER_CM}"/></a:xfrm>
  <a:prstGeom prst="${prst}"/></p:spPr>
</p:cxnSp>`

const buildPptx = async (
  slides: string[][],
  options: {
    media?: Array<[name: string, bytes: Buffer]>
    slideRels?: Record<number, string>
  } = {},
): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst>
    </p:presentation>`,
  )
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    ${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="s" Target="slides/slide${i + 1}.xml"/>`).join('')}
    </Relationships>`,
  )
  slides.forEach((shapes, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?>
      <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld>
      </p:sld>`,
    )
    const rels = options.slideRels?.[i + 1]
    if (rels !== undefined) {
      zip.file(
        `ppt/slides/_rels/slide${i + 1}.xml.rels`,
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      )
    }
  })
  for (const [name, bytes] of options.media ?? []) {
    zip.file(`ppt/media/${name}`, bytes)
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('harvestDocx — boxes, arrows, and geometry from the drawing XML', () => {
  it('returns each drawn box once with its label, position in cm, and shape kind', async () => {
    const bytes = await buildDocx(
      [
        anchoredBox('מנהלת רשת', 8, 2),
        anchoredBox('מנהל תפעול', 4, 6),
        anchoredBox('', 8.5, 4, 'downArrow'),
      ].join(''),
    )
    const harvest = await harvestDocx(bytes)
    expect(harvest.shapes).toHaveLength(3)

    const boss = harvest.shapes.find((s) => s.text === 'מנהלת רשת')
    expect(boss).toMatchObject({ kind: 'rect', x: 8, y: 2, w: 4, h: 1, page: 1 })
    // The VML fallback repeats every label; a harvested box must not appear twice.
    expect(harvest.shapes.filter((s) => s.text === 'מנהלת רשת')).toHaveLength(1)

    const arrow = harvest.shapes.find((s) => s.kind === 'downArrow')
    expect(arrow).toMatchObject({ text: '', x: 8.5, y: 4 })
  })

  it('collects raster media for the vision path and leaves vector media behind', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const emf = Buffer.from([0x01, 0x00, 0x00, 0x00])
    const bytes = await buildDocx(anchoredBox('כותרת', 1, 1), [
      ['image1.png', png],
      ['image2.emf', emf],
    ])
    const harvest = await harvestDocx(bytes)
    expect(harvest.images).toHaveLength(1)
    expect(harvest.images[0]).toMatchObject({ name: 'image1.png', contentType: 'image/png' })
    expect(harvest.images[0]?.bytes.equals(png)).toBe(true)
  })

  it('marks boxes as placed only when their vertical anchor is absolute (page/margin)', async () => {
    // Word anchors a floating box to a PARAGRAPH by default, and then its offsets are relative
    // to wherever that paragraph landed — two boxes anchored to different paragraphs live in
    // different coordinate spaces, and comparing their y values invents tiers that are not
    // drawn (the מוקד lesson: two peers side by side read as three tiers). Only a page- or
    // margin-relative vertical anchor makes cross-box geometry meaningful.
    const paragraphBox = anchoredBox('מנהל מוקד', 8, 1).replace(
      '<wp:positionV relativeFrom="page">',
      '<wp:positionV relativeFrom="paragraph">',
    )
    const bytes = await buildDocx([paragraphBox, anchoredBox('מנהלת רשת', 4, 4)].join(''))
    const harvest = await harvestDocx(bytes)
    expect(harvest.shapes.find((s) => s.text === 'מנהל מוקד')?.placed).toBe(false)
    expect(harvest.shapes.find((s) => s.text === 'מנהלת רשת')?.placed).toBe(true)
  })

  it('keeps only the media the document body references — a header logo never reaches the vision path', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    // Both images sit in word/media, but only image1 is referenced from document.xml; the logo is
    // referenced from a header part (letterhead), which the harvest never reads — so with a rels
    // part present, the logo drops deterministically, before any model could describe it.
    const body = `${anchoredBox('כותרת', 1, 1)}<w:p><w:r><w:drawing><a:blip r:embed="rId7"/></w:drawing></w:r></w:p>`
    const rels = `
      <Relationship Id="rId7" Type="i" Target="media/image1.png"/>
      <Relationship Id="rId8" Type="i" Target="media/logo.png"/>`
    const bytes = await buildDocx(
      body,
      [
        ['image1.png', png],
        ['logo.png', png],
      ],
      rels,
    )
    const harvest = await harvestDocx(bytes)
    expect(harvest.images.map((image) => image.name)).toEqual(['image1.png'])
  })

  it('keeps every raster when the package has no document rels part (best-effort posture)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const bytes = await buildDocx(anchoredBox('כותרת', 1, 1), [
      ['image1.png', png],
      ['image2.png', png],
    ])
    const harvest = await harvestDocx(bytes)
    expect(harvest.images).toHaveLength(2)
  })
})

describe('harvestPptx — slide shapes with their slide number', () => {
  it('returns shapes per slide with text, geometry, and connectors as arrows', async () => {
    const bytes = await buildPptx([
      [
        pptxShape('מנכ"ל', 10, 1),
        pptxShape('סמנכ"ל', 10, 5),
        pptxConnector(11, 3, 'bentConnector3'),
      ],
      [pptxShape('נספח', 2, 2)],
    ])
    const harvest = await harvestPptx(bytes)
    expect(harvest.shapes).toHaveLength(4)
    expect(harvest.shapes.find((s) => s.text === 'מנכ"ל')).toMatchObject({ page: 1, x: 10, y: 1 })
    expect(harvest.shapes.find((s) => s.text === 'נספח')).toMatchObject({ page: 2 })
    expect(harvest.shapes.find((s) => s.kind === 'bentConnector3')?.text).toBe('')
    // The element itself marks a connector — a plain shape never does. This is what separates a
    // real drawn reporting line from a decorative block-arrow glyph downstream.
    expect(harvest.shapes.find((s) => s.kind === 'bentConnector3')?.connector).toBe(true)
    expect(harvest.shapes.find((s) => s.text === 'מנכ"ל')?.connector).toBe(false)
    // Slide coordinates are absolute by construction, so a deck's shapes are always placed.
    expect(harvest.shapes.every((s) => s.placed)).toBe(true)
  })

  it('flags a cxnSp as a connector even when it carries no preset geometry', async () => {
    // A connector whose spPr has no prstGeom harvests as kind 'unknown'; the element must still
    // mark it, or the one chart with real (and correct) reporting lines would fall back to
    // layout-only transcription and lose them.
    const bareConnector = `<p:cxnSp><p:spPr><a:xfrm><a:off x="360000" y="360000"/><a:ext cx="360000" cy="360000"/></a:xfrm></p:spPr></p:cxnSp>`
    const bytes = await buildPptx([[pptxShape('מנכ"ל', 10, 1), bareConnector]])
    const harvest = await harvestPptx(bytes)
    expect(harvest.shapes.find((s) => s.kind === 'unknown')?.connector).toBe(true)
  })

  it('keeps only the media the slides reference — a master-slide logo never reaches the vision path', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    // logo.png sits in ppt/media because the slide MASTER references it; no slide does. With
    // slide rels present, only slide-referenced media survives.
    const bytes = await buildPptx(
      [[`${pptxShape('מנכ"ל', 10, 1)}<p:pic><a:blip r:embed="rId2"/></p:pic>`]],
      {
        media: [
          ['image1.png', png],
          ['logo.png', png],
        ],
        slideRels: { 1: '<Relationship Id="rId2" Type="i" Target="../media/image1.png"/>' },
      },
    )
    const harvest = await harvestPptx(bytes)
    expect(harvest.images.map((image) => image.name)).toEqual(['image1.png'])
  })

  it('keeps every raster when no slide has a rels part (best-effort posture)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const bytes = await buildPptx([[pptxShape('מנכ"ל', 10, 1)]], {
      media: [['image1.png', png]],
    })
    const harvest = await harvestPptx(bytes)
    expect(harvest.images).toHaveLength(1)
  })
})
