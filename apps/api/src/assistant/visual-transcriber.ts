import mammoth from 'mammoth'
import { DOCX_MIME_TYPE, PPTX_MIME_TYPE } from './document-extraction.js'
import type { LlmClient } from './llm-client.js'
import { type HarvestedShape, harvestDocx, harvestPptx } from './shape-harvest.js'

// The visual transcriber (2026-09 plan, phase 2): turns a diagram-flagged document into honest,
// indexable text. Two channels, both grounded in what the file actually contains (verified
// against the real corpus 2026-09-02 — no SmartArt, no connectors, just positioned text boxes
// and, in the procedure class, embedded screenshots):
//
//   - The CHART channel hands a text model the harvested boxes WITH their page geometry and asks
//     for the hierarchy in full Hebrew sentences. No page is ever rendered; the geometry is the
//     layout. The anti-miss rule from the design research (models MISS boxes far more than they
//     invent them) is enforced deterministically: every harvested label must appear in the
//     output, one corrective retry naming what was lost, then failure — a doc that cannot be
//     transcribed faithfully stays flagged rather than ingesting a guessed hierarchy.
//   - The SCREENSHOT channel sends each embedded raster image to the (vision-capable) model with
//     the document's own text as context, and files the descriptions as marked lines.
//
// Failure is always the flagged status quo, never fabricated content; reasons carry error
// classes only, never model output (ADR-0011 discipline).

export interface VisualTranscription {
  ok: true
  content: string
}
export interface VisualTranscriptionFailure {
  ok: false
  reason: string
}
export type VisualTranscriptionResult = VisualTranscription | VisualTranscriptionFailure

export interface VisualTranscriber {
  transcribe(input: {
    title: string
    mimeType: string
    bytes: Buffer
  }): Promise<VisualTranscriptionResult>
}

// Below three labeled boxes there is no chart to reconstruct — mirrors DIAGRAM_MIN_ELEMENTS.
const MIN_CHART_BOXES = 3
// The junk floor for the vision path: tracked-changes bullets, list glyphs, and tiny logos live
// under this; a real screenshot of a software window does not.
export const MIN_DESCRIBABLE_IMAGE_BYTES = 8 * 1024
// And a ceiling so one enormous photo cannot blow the request: providers cap data-URL parts.
const MAX_DESCRIBABLE_IMAGE_BYTES = 4 * 1024 * 1024
// At most this many screenshots per document reach the model — cost discipline.
const MAX_DESCRIBED_IMAGES = 10
// Chart shapes are capped the same way; beyond this a "chart" is something else entirely.
const MAX_CHART_SHAPES = 80

const CHART_MAX_TOKENS = 1200
const IMAGE_MAX_TOKENS = 300
// How much of the document's own text rides along as context for a screenshot description.
const IMAGE_CONTEXT_CHARS = 600

// A word beginning with a Hebrew final letter (ך ם ן ף ץ) exists only in reversed (bidi-mangled)
// output — final forms are word-final by definition — so a single occurrence rejects the output.
const REVERSED_BIDI = /(^|[\s"'([{-])[ךםןףץ]/

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const shapeLine = (shape: HarvestedShape): string =>
  `- "${normalize(shape.text)}" (עמוד ${shape.page}, x=${shape.x}, y=${shape.y}, רוחב=${shape.w}, גובה=${shape.h})`

const arrowLine = (shape: HarvestedShape): string =>
  `- ${shape.kind} (עמוד ${shape.page}, x=${shape.x}, y=${shape.y})`

// Reading order for the prompt: page, then top-to-bottom, then left-to-right. The model sees the
// chart the way a reader scans it, which is half the hierarchy already.
const byReadingOrder = (a: HarvestedShape, b: HarvestedShape): number =>
  a.page - b.page || a.y - b.y || a.x - b.x

function chartPrompt(title: string, boxes: HarvestedShape[], arrows: HarvestedShape[]): string {
  return [
    `מסמך: "${title}"`,
    '',
    'להלן התיבות שצוירו במסמך, עם מיקומן בסנטימטרים (x נמדד משמאל, y מלמעלה):',
    ...boxes.map(shapeLine),
    ...(arrows.length > 0 ? ['', 'חיצים ומחברים שצוירו:', ...arrows.map(arrowLine)] : []),
    '',
    'משימה: תמלל את התרשים לטקסט בעברית.',
    '1. כתוב שורת כותרת קצרה למבנה.',
    '2. כתוב את ההיררכיה במשפטים מלאים, למשל "X כפוף/ה ל-Y" — לפי המיקום והחיצים:',
    '   תיבה גבוהה יותר (y קטן) היא דרג בכיר יותר; תיבות באותו גובה הן אותו דרג.',
    '3. כל תיבה מהרשימה חייבת להופיע בתמלול, בדיוק בנוסח שבו היא כתובה ברשימה.',
    '4. אל תמציא תיבות שאינן ברשימה, ואם קשר אינו ברור מהפריסה — כתוב שהוא לא ודאי.',
  ].join('\n')
}

const CHART_SYSTEM =
  'אתה מתמלל תרשימים ארגוניים ותרשימי זרימה מתוך רשימת הצורות והמיקומים שלהן. ענה בעברית בלבד, כטקסט רציף.'

const SCREENSHOT_SYSTEM = 'אתה מתאר צילומי מסך מתוך נהלי עבודה. ענה בעברית בלבד, בקצרה ובמדויק.'

function screenshotPrompt(title: string, context: string): string {
  return [
    `צילום מסך מתוך המסמך "${title}".`,
    context === '' ? '' : `הקשר מתוך המסמך: ${context}`,
    'תאר ב-1 עד 3 משפטים מה מוצג בצילום, כולל שמות כפתורים, שדות ותפריטים במדויק כפי שהם מופיעים.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// Every harvested label must appear (whitespace-normalized) in the output, and the output must
// not read reversed. Returns the missing labels so the retry can name them.
function validateChart(
  output: string,
  boxes: HarvestedShape[],
): { missing: string[]; reversed: boolean } {
  const haystack = normalize(output)
  const missing = boxes
    .map((box) => normalize(box.text))
    .filter((label) => label !== '' && !haystack.includes(label))
  return { missing, reversed: REVERSED_BIDI.test(output) }
}

export interface VisualTranscriberDeps {
  llm: LlmClient
  onError?: (message: string) => void
}

export function createVisualTranscriber(deps: VisualTranscriberDeps): VisualTranscriber {
  const reportError = deps.onError ?? (() => {})

  const transcribeChart = async (
    title: string,
    boxes: HarvestedShape[],
    arrows: HarvestedShape[],
  ): Promise<VisualTranscriptionResult> => {
    const basePrompt = chartPrompt(title, boxes, arrows)
    let prompt = basePrompt
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await deps.llm.complete({
        messages: [
          { role: 'system', content: CHART_SYSTEM },
          { role: 'user', content: prompt },
        ],
        maxTokens: CHART_MAX_TOKENS,
      })
      if (!result.ok) {
        return { ok: false, reason: `chart transcription failed: ${result.error}` }
      }
      const { missing, reversed } = validateChart(result.content, boxes)
      if (missing.length === 0 && !reversed) {
        return { ok: true, content: result.content.trim() }
      }
      // One corrective retry, naming exactly what was wrong — the anti-miss discipline.
      prompt = [
        basePrompt,
        '',
        'הניסיון הקודם נפסל:',
        ...(missing.length > 0 ? [`חסרו התיבות הבאות: ${missing.join(' | ')}`] : []),
        ...(reversed ? ['סדר האותיות בעברית יצא הפוך — כתוב את הטקסט משמאל לימין תקין.'] : []),
        'כתוב את התמלול מחדש, מלא ותקין.',
      ].join('\n')
    }
    return { ok: false, reason: 'chart transcription failed validation after retry' }
  }

  const describeImages = async (
    title: string,
    context: string,
    images: Array<{ contentType: string; bytes: Buffer }>,
  ): Promise<string[]> => {
    const descriptions: string[] = []
    for (const image of images) {
      const dataUrl = `data:${image.contentType};base64,${image.bytes.toString('base64')}`
      const result = await deps.llm.complete({
        messages: [
          { role: 'system', content: SCREENSHOT_SYSTEM },
          { role: 'user', content: screenshotPrompt(title, context) },
        ],
        maxTokens: IMAGE_MAX_TOKENS,
        images: [dataUrl],
      })
      // Best-effort per image: one refused screenshot does not lose the rest.
      if (result.ok) {
        descriptions.push(result.content.trim())
      } else {
        reportError(`screenshot description failed: ${result.error}`)
      }
    }
    return descriptions
  }

  return {
    transcribe: async ({ title, mimeType, bytes }) => {
      let harvest: Awaited<ReturnType<typeof harvestDocx>>
      let bodyText = ''
      if (mimeType === DOCX_MIME_TYPE) {
        harvest = await harvestDocx(bytes)
        // The document's own paragraphs (mammoth never sees the shapes) stay part of the content.
        bodyText = (await mammoth.extractRawText({ buffer: bytes })).value.trim()
      } else if (mimeType === PPTX_MIME_TYPE) {
        // A deck's visible text lives in the very boxes being transcribed — no separate body.
        harvest = await harvestPptx(bytes)
      } else {
        return { ok: false, reason: `visual transcription does not support ${mimeType}` }
      }

      const shapes = [...harvest.shapes].sort(byReadingOrder).slice(0, MAX_CHART_SHAPES)
      const boxes = shapes.filter((shape) => normalize(shape.text) !== '')
      const arrows = shapes.filter((shape) => normalize(shape.text) === '')
      const describable = harvest.images
        .filter(
          (image) =>
            image.bytes.length >= MIN_DESCRIBABLE_IMAGE_BYTES &&
            image.bytes.length <= MAX_DESCRIBABLE_IMAGE_BYTES,
        )
        .slice(0, MAX_DESCRIBED_IMAGES)

      const chartWorthy = boxes.length >= MIN_CHART_BOXES
      if (!chartWorthy && describable.length === 0) {
        return { ok: false, reason: 'nothing transcribable: no labeled boxes and no real images' }
      }

      let chartSection: string | null = null
      if (chartWorthy) {
        const chart = await transcribeChart(title, boxes, arrows)
        // The chart IS the document here — a failed chart keeps the doc flagged rather than
        // ingesting it with its core content missing.
        if (!chart.ok) return chart
        chartSection = chart.content
      }

      const descriptions = await describeImages(
        title,
        normalize(bodyText).slice(0, IMAGE_CONTEXT_CHARS),
        describable,
      )
      if (chartSection === null && descriptions.length === 0) {
        return { ok: false, reason: 'no screenshot could be described' }
      }

      const parts: string[] = []
      if (bodyText !== '') parts.push(bodyText)
      if (chartSection !== null) {
        parts.push(`[תמלול אוטומטי של התרשים]\n${chartSection}`)
      }
      if (descriptions.length > 0) {
        parts.push(descriptions.map((text, i) => `[תמונה ${i + 1}] ${text}`).join('\n'))
      }
      return { ok: true, content: parts.join('\n\n') }
    },
  }
}
