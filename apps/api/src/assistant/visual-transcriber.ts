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

// The chart completion budget scales with the chart and floors generously: the first prod run
// (2026-09-02) cut EVERY mid-sized chart off at a fixed 1,200 — the Pro model spends reasoning
// tokens inside the same max_tokens budget, and Hebrew hierarchy sentences are token-dense
// (~2-2.5 chars/token). Truncation folds to a failure in the client, so an undersized budget
// does not corrupt content — it just flags documents that should have transcribed.
const CHART_MIN_TOKENS = 3000
const CHART_TOKENS_PER_BOX = 150
const chartMaxTokens = (boxCount: number): number =>
  Math.max(CHART_MIN_TOKENS, CHART_TOKENS_PER_BOX * boxCount)
const IMAGE_MAX_TOKENS = 600
// How much of the document's own text rides along as context for a screenshot description.
const IMAGE_CONTEXT_CHARS = 600

// A word beginning with a Hebrew final letter (ך ם ן ף ץ) exists only in reversed (bidi-mangled)
// output — final forms are word-final by definition — so a single occurrence rejects the output.
const REVERSED_BIDI = /(^|[\s"'([{-])[ךםןףץ]/

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim()

const shapeLine = (shape: HarvestedShape): string =>
  `- "${normalize(shape.text)}" (עמוד ${shape.page}, x=${shape.x}, y=${shape.y}, רוחב=${shape.w}, גובה=${shape.h})`

// The geometry-less spelling for untrusted coordinates — showing numbers the model must not
// reason from only tempts it.
const plainShapeLine = (shape: HarvestedShape): string => `- "${normalize(shape.text)}"`

// Structure claims the untrusted-geometry prompt forbids, enforced deterministically below: the
// prohibition in the prompt is advice, this regex is the gate. Box labels in this corpus never
// carry these words, so a match is always the model's own inference.
const FORBIDDEN_STRUCTURE = /כפוף|כפופ|בכיר|היררכי|דרג/

const arrowLine = (shape: HarvestedShape): string =>
  `- ${shape.kind} (עמוד ${shape.page}, x=${shape.x}, y=${shape.y})`

// Reading order for the prompt: page, then top-to-bottom, then left-to-right. The model sees the
// chart the way a reader scans it, which is half the hierarchy already.
const byReadingOrder = (a: HarvestedShape, b: HarvestedShape): number =>
  a.page - b.page || a.y - b.y || a.x - b.x

// A textless shape whose KIND reads as a connector — the docx spelling of a drawn line (Word
// writes connectors as wps:wsp with a straightConnector1/bentConnector3 preset).
const CONNECTOR_KIND = /connector|^line$/i

// Two prompt postures, decided by whether the chart draws REAL connectors between its boxes.
// With connectors present the drawing encodes direction and the model may assert reporting
// lines (the one such chart in the corpus, the pptx master chart, transcribed correctly). With
// none — and this includes decorative block-arrow glyphs, which v2 wrongly trusted — direction
// is a guess however confident the geometry looks: the reloaded corpus showed even a HEDGED
// direction guess still leads with the wrong claim (finance inverted, מוקד tiering peers). So
// without connectors the model describes the page layout only and may not use subordination or
// seniority wording at all. Boxes that all sit at (0,0) were never positioned (inline anchors),
// and then even the layout description falls back to document order.
function chartPrompt(
  title: string,
  boxes: HarvestedShape[],
  arrows: HarvestedShape[],
  trusted: boolean,
): string {
  // Untrusted coordinates (paragraph-anchored Word boxes) void everything geometric: no box
  // positions, no arrow list, no structure — even a real connector cannot be resolved to
  // endpoints when its own offsets float with a paragraph. Names in document order, nothing else.
  if (!trusted) {
    return [
      `מסמך: "${title}"`,
      '',
      'להלן התיבות המופיעות במסמך, לפי סדר הופעתן (למסמך זה אין נתוני מיקום אמינים):',
      ...boxes.map(plainShapeLine),
      '',
      'משימה: תמלל את תוכן התרשים לטקסט בעברית.',
      '1. כתוב שורת כותרת קצרה למבנה.',
      '2. פרט את התיבות לפי סדר הופעתן בלבד.',
      '3. במסמך זה אי אפשר לדעת מי כפוף למי או מי בכיר: אל תכתוב יחסי כפיפות, דרגים או היררכיה כלל — גם לא במשוער — ואל תשתמש במילים כמו "כפוף", "בכיר", "דרג" או "בראש".',
      '4. כל תיבה מהרשימה חייבת להופיע בתמלול, בדיוק בנוסח שבו היא כתובה ברשימה.',
      '5. אל תמציא תיבות שאינן ברשימה.',
    ].join('\n')
  }
  const unplaced = boxes.length > 1 && boxes.every((box) => box.x === 0 && box.y === 0)
  const connected = arrows.some((arrow) => arrow.connector || CONNECTOR_KIND.test(arrow.kind))
  const rules: string[] = ['כתוב שורת כותרת קצרה למבנה.']
  if (connected) {
    rules.push(
      'כתוב את ההיררכיה במשפטים מלאים, למשל "X כפוף/ה ל-Y" — לפי המיקום והחיצים:\n   תיבה גבוהה יותר (y קטן) היא דרג בכיר יותר; תיבות באותו גובה הן אותו דרג.',
    )
    rules.push('כל תיבה מהרשימה חייבת להופיע בתמלול, בדיוק בנוסח שבו היא כתובה ברשימה.')
    rules.push('אל תמציא תיבות שאינן ברשימה, ואם קשר אינו ברור מהפריסה — כתוב שהוא לא ודאי.')
  } else {
    rules.push(
      unplaced
        ? 'למסמך אין נתוני מיקום אמינים — פרט את התיבות לפי סדר הופעתן בלבד.'
        : 'תאר את פריסת התיבות על העמוד בלבד: אילו תיבות בחלק העליון, אילו מתחתן, ואילו זו לצד זו.',
    )
    rules.push(
      'בתרשים לא צוירו קווי חיבור בין התיבות, ולכן אי אפשר לדעת ממנו מי כפוף למי או מי בכיר: אל תכתוב יחסי כפיפות, דרגים או היררכיה כלל — גם לא בניסוח משוער — ואל תשתמש במילים כמו "כפוף", "בכיר", "דרג" או "בראש".',
    )
    rules.push('כל תיבה מהרשימה חייבת להופיע בתמלול, בדיוק בנוסח שבו היא כתובה ברשימה.')
    rules.push('אל תמציא תיבות שאינן ברשימה.')
  }
  return [
    `מסמך: "${title}"`,
    '',
    'להלן התיבות שצוירו במסמך, עם מיקומן בסנטימטרים (x נמדד משמאל, y מלמעלה):',
    ...boxes.map(shapeLine),
    // Arrows are listed only when they are trusted; a decorative glyph the model may not reason
    // from is better left out of sight entirely.
    ...(connected && arrows.length > 0
      ? ['', 'חיצים ומחברים שצוירו:', ...arrows.map(arrowLine)]
      : []),
    '',
    'משימה: תמלל את התרשים לטקסט בעברית.',
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
  ].join('\n')
}

const CHART_SYSTEM =
  'אתה מתמלל תרשימים ארגוניים ותרשימי זרימה מתוך רשימת הצורות והמיקומים שלהן. ענה בעברית בלבד, כטקסט רציף.'

const SCREENSHOT_SYSTEM = 'אתה מתאר צילומי מסך מתוך נהלי עבודה. ענה בעברית בלבד, בקצרה ובמדויק.'

// The sentinel a classified-junk image answers with. Latin and unmistakable on purpose: it can
// never appear in an honest Hebrew description, so testing the reply's first word is exact.
const JUNK_SENTINEL = /^JUNK\b/i

function screenshotPrompt(title: string, context: string): string {
  return [
    `תמונה מתוך המסמך "${title}".`,
    context === '' ? '' : `הקשר מתוך המסמך: ${context}`,
    'אם התמונה היא לוגו, סמל, כותרת עליונה או תחתונה של מסמך, פרטי יצירת קשר או קישוט עיצובי — השב במילה אחת בלבד: JUNK.',
    'אחרת, תאר ב-1 עד 3 משפטים מה מוצג בתמונה, כולל שמות כפתורים, שדות ותפריטים במדויק כפי שהם מופיעים.',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// Every harvested label must appear (whitespace-normalized) in the output, and the output must
// not read reversed. Returns the missing labels so the retry can name them.
function validateChart(
  output: string,
  boxes: HarvestedShape[],
  trusted: boolean,
): { missing: string[]; reversed: boolean; forbidden: boolean } {
  const haystack = normalize(output)
  const missing = boxes
    .map((box) => normalize(box.text))
    .filter((label) => label !== '' && !haystack.includes(label))
  return {
    missing,
    reversed: REVERSED_BIDI.test(output),
    // Over untrusted geometry the prompt forbids structure claims; a model that makes them
    // anyway is rejected here, deterministically — the same posture as the anti-miss rule.
    forbidden: !trusted && FORBIDDEN_STRUCTURE.test(output),
  }
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
    trusted: boolean,
  ): Promise<VisualTranscriptionResult> => {
    const basePrompt = chartPrompt(title, boxes, arrows, trusted)
    let prompt = basePrompt
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await deps.llm.complete({
        messages: [
          { role: 'system', content: CHART_SYSTEM },
          { role: 'user', content: prompt },
        ],
        maxTokens: chartMaxTokens(boxes.length),
      })
      if (!result.ok) {
        return { ok: false, reason: `chart transcription failed: ${result.error}` }
      }
      const { missing, reversed, forbidden } = validateChart(result.content, boxes, trusted)
      if (missing.length === 0 && !reversed && !forbidden) {
        return { ok: true, content: result.content.trim() }
      }
      // One corrective retry, naming exactly what was wrong — the anti-miss discipline.
      prompt = [
        basePrompt,
        '',
        'הניסיון הקודם נפסל:',
        ...(missing.length > 0 ? [`חסרו התיבות הבאות: ${missing.join(' | ')}`] : []),
        ...(reversed ? ['סדר האותיות בעברית יצא הפוך — כתוב את הטקסט משמאל לימין תקין.'] : []),
        ...(forbidden
          ? ['נכתבו קביעות על כפיפות או דרגים — אסור במסמך זה; פרט את התיבות בלבד.']
          : []),
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
      // Best-effort per image: one refused screenshot does not lose the rest. A reply carrying
      // the junk sentinel is a logo/letterhead classification, dropped silently by design — the
      // 2026-09-02 audit found logo descriptions appended to 7 docs, one of them 90% letterhead.
      if (result.ok) {
        const text = result.content.trim()
        if (!JUNK_SENTINEL.test(text)) {
          descriptions.push(text)
        }
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

      // Reading-order sorting relies on comparable coordinates; untrusted geometry keeps the
      // document's own order instead (sorting by incomparable y would scramble it).
      const trusted = harvest.shapes.length > 0 && harvest.shapes.every((shape) => shape.placed)
      const shapes = (
        trusted ? [...harvest.shapes].sort(byReadingOrder) : [...harvest.shapes]
      ).slice(0, MAX_CHART_SHAPES)
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
        const chart = await transcribeChart(title, boxes, arrows, trusted)
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
        return { ok: false, reason: 'no screenshot could be described (or all were decoration)' }
      }

      // No inline provenance marker: '[תמלול אוטומטי של התרשים]' used to head the chart section,
      // and its words joined every transcribed doc's keyword statistics. Provenance is the doc
      // row's transcribed_at stamp now (knowledge-sync sets it), never the indexed text.
      const parts: string[] = []
      if (bodyText !== '') parts.push(bodyText)
      if (chartSection !== null) parts.push(chartSection)
      if (descriptions.length > 0) {
        parts.push(descriptions.map((text, i) => `[תמונה ${i + 1}] ${text}`).join('\n'))
      }
      return { ok: true, content: parts.join('\n\n') }
    },
  }
}
