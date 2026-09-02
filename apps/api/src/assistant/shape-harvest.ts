import JSZip from 'jszip'
import { decodeHtmlEntities, pptxSlidePaths } from './document-extraction.js'

// The shape harvester (2026-09 plan, phase 2). A diagram-flagged OOXML document carries its
// meaning in drawn boxes whose labels AND page positions sit right in the XML — the corpus's org
// charts use no SmartArt and no connectors (verified against the real files 2026-09-02), just
// floating text boxes plus arrow shapes laid out visually. Harvesting text + geometry is what
// lets a plain text model reconstruct the hierarchy, with no page rendering, no LibreOffice, and
// no Hebrew-font risk. Raster media is collected for the vision path (the screenshot-procedure
// class); vector media (emf/wmf) is left behind — nothing here can rasterize it, and modern Word
// rarely emits it as the only copy.
//
// Best-effort by design, like the element counter: this is a regex walk, not an XML parser. A
// shape it cannot place still surfaces with its text at (0,0); a grouped pptx shape reports its
// group-relative offset (the child-transform math is not worth its weight here — the transcriber
// only needs relative layout, and the validator checks labels, not coordinates).

export interface HarvestedShape {
  // The box's visible text ('' for an arrow or decoration).
  text: string
  // The preset geometry name ('rect', 'downArrow', 'bentConnector3', ... or 'unknown') — how the
  // transcription prompt tells a labeled box from a drawn arrow.
  kind: string
  // Position and size in centimeters (from EMU), rounded to one decimal.
  x: number
  y: number
  w: number
  h: number
  // 1-based slide number for a deck; always 1 for a DOCX (its anchors are body-relative).
  page: number
}

export interface HarvestedImage {
  name: string
  contentType: string
  bytes: Buffer
}

export interface HarvestedVisual {
  shapes: HarvestedShape[]
  images: HarvestedImage[]
}

const EMU_PER_CM = 360000
const cm = (emu: number): number => Math.round((emu / EMU_PER_CM) * 10) / 10

// The raster formats the vision path can send; anything else in the media dir is skipped.
const RASTER_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const first = (block: string, re: RegExp): string | null => block.match(re)?.[1] ?? null

const shapeTexts = (block: string, runRe: RegExp): string =>
  [...block.matchAll(runRe)]
    .map((m) => decodeHtmlEntities(m[1] as string).trim())
    .filter((t) => t !== '')
    .join(' ')

// The relationship id → target map of one part's .rels file. Attribute order varies by writer,
// so Id and Target are matched independently within each Relationship tag.
const relTargets = (relsXml: string): Map<string, string> => {
  const map = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = match[0].match(/ Id="([^"]+)"/)?.[1]
    const target = match[0].match(/ Target="([^"]+)"/)?.[1]
    if (id !== undefined && target !== undefined) {
      map.set(id, target)
    }
  }
  return map
}

// A rels target like 'media/image1.png', '../media/image1.png' or '/word/media/image1.png',
// reduced to the media file's own name; null for anything not in a media dir (an external link,
// a hyperlink target).
const mediaName = (target: string): string | null =>
  target.match(/(?:^|\/)media\/([^/]+)$/)?.[1] ?? null

// The media names one part actually references (r:embed for a picture fill, r:id for the VML
// spelling), resolved through its rels map. What a part never references, a reader never sees —
// which is exactly the letterhead case: a header/footer logo lives in the media dir but is
// referenced only from its header part, so filtering to the content parts' own references drops
// it deterministically, before any model is asked to describe it.
const referencedMedia = (partXml: string, rels: Map<string, string>): Set<string> => {
  const used = new Set<string>()
  for (const match of partXml.matchAll(/(?:r:embed|r:id)="([^"]+)"/g)) {
    const target = rels.get(match[1] as string)
    const name = target === undefined ? null : mediaName(target)
    if (name !== null) {
      used.add(name)
    }
  }
  return used
}

async function collectMedia(zip: JSZip, prefix: string): Promise<HarvestedImage[]> {
  const images: HarvestedImage[] = []
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith(prefix) || entry.dir) continue
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const contentType = RASTER_CONTENT_TYPES[ext]
    if (!contentType) continue
    images.push({
      name: name.slice(prefix.length),
      contentType,
      bytes: await entry.async('nodebuffer'),
    })
  }
  return images
}

// Harvest a Word document's drawn shapes. Each <w:drawing> block is one shape as authored: its
// anchor carries the page offset and extent, its wps body carries the preset geometry and the
// text-box content. Matching inside <w:drawing> only is what dedupes the VML fallback — Word
// writes every shape twice (Choice + Fallback), and the fallback twin holds no <w:drawing>.
export async function harvestDocx(bytes: Buffer): Promise<HarvestedVisual> {
  const zip = await JSZip.loadAsync(bytes)
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? ''
  const shapes: HarvestedShape[] = []
  for (const match of xml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
    const block = match[0]
    const x = first(block, /<wp:positionH[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/)
    const y = first(block, /<wp:positionV[^>]*>[\s\S]*?<wp:posOffset>(-?\d+)<\/wp:posOffset>/)
    const extent = block.match(/<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
    shapes.push({
      text: shapeTexts(block, /<w:t[^>]*>([^<]*)<\/w:t>/g),
      kind: first(block, /<a:prstGeom[^>]*prst="([^"]+)"/) ?? 'unknown',
      x: cm(Number(x ?? 0)),
      y: cm(Number(y ?? 0)),
      w: cm(Number(extent?.[1] ?? 0)),
      h: cm(Number(extent?.[2] ?? 0)),
      page: 1,
    })
  }
  let images = await collectMedia(zip, 'word/media/')
  // Only what the document BODY references reaches the vision path; a package with no rels part
  // at all (minimal or hand-built) keeps the best-effort posture and everything survives.
  const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
  if (rels !== undefined) {
    const used = referencedMedia(xml, relTargets(rels))
    images = images.filter((image) => used.has(image.name))
  }
  return { shapes, images }
}

// Harvest a deck's shapes per slide, in presentation order. Plain shapes and connectors are the
// two spellings a slide draws with; connectors carry no text and read as arrows by their preset.
export async function harvestPptx(bytes: Buffer): Promise<HarvestedVisual> {
  const zip = await JSZip.loadAsync(bytes)
  const slidePaths = await pptxSlidePaths(zip)
  const shapes: HarvestedShape[] = []
  // The media the slides themselves reference. A logo placed on the slide master or layout sits
  // in ppt/media too, but no slide references it — so with slide rels present it drops here, the
  // same letterhead discipline as the DOCX path.
  const used = new Set<string>()
  let sawSlideRels = false
  for (const [index, path] of slidePaths.entries()) {
    const xml = (await zip.file(path)?.async('string')) ?? ''
    const rels = await zip
      .file(path.replace(/^ppt\/slides\/(slide\d+\.xml)$/, 'ppt/slides/_rels/$1.rels'))
      ?.async('string')
    if (rels !== undefined) {
      sawSlideRels = true
      for (const name of referencedMedia(xml, relTargets(rels))) {
        used.add(name)
      }
    }
    for (const match of xml.matchAll(/<p:(?:sp|cxnSp)[\s>][\s\S]*?<\/p:(?:sp|cxnSp)>/g)) {
      const block = match[0]
      const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"/)
      const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
      shapes.push({
        text: shapeTexts(block, /<a:t>([^<]*)<\/a:t>/g),
        kind: first(block, /<a:prstGeom[^>]*prst="([^"]+)"/) ?? 'unknown',
        x: cm(Number(off?.[1] ?? 0)),
        y: cm(Number(off?.[2] ?? 0)),
        w: cm(Number(ext?.[1] ?? 0)),
        h: cm(Number(ext?.[2] ?? 0)),
        page: index + 1,
      })
    }
  }
  let images = await collectMedia(zip, 'ppt/media/')
  if (sawSlideRels) {
    images = images.filter((image) => used.has(image.name))
  }
  return { shapes, images }
}
