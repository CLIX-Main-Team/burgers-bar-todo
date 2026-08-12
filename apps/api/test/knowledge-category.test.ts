import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PDF_MIME_TYPE } from '../src/assistant/document-extraction.js'
import { GOOGLE_DOC_MIME_TYPE } from '../src/assistant/drive-client.js'
import { type LlmCompletionRequest, PROVIDER_PRESETS } from '../src/assistant/llm-client.js'
import { type AssistantHarness, createAssistantHarness } from './helpers/assistant-harness.js'

// The knowledge categorizer (ADR-0024): after every reconcile pass, each Knowledge Doc whose
// category is still NULL is filed under one fixed shelf via the LLM port, so the admin
// Knowledge tab shows an organized corpus that maintains itself. Assertions are external
// behaviour only — category state read back through the repository after a sync, and the fake
// LLM's captured requests — never the prompt wording or internals. The fake Drive, fake LLM,
// and injected clock are the only substitutions; the sweep runs against a real migrated
// Postgres with no network.

const SCANNED_PDF = readFileSync(new URL('./fixtures/scanned-procedure.pdf', import.meta.url))

// An obedient model for these cases: replies with a slug keyed off the title the request
// carries, so filing reflects each doc rather than one canned answer.
const respondByTitle = (rules: Record<string, string>) => (request: LlmCompletionRequest) => {
  const user = request.messages.find((m) => m.role === 'user')?.content ?? ''
  const match = Object.entries(rules).find(([title]) => user.includes(title))
  return { ok: true as const, content: match?.[1] ?? 'general' }
}

describe('assistant: knowledge categorizer files docs after each sync (ADR-0024)', () => {
  let harness: AssistantHarness

  beforeAll(async () => {
    harness = await createAssistantHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.reset()
  })

  const reconcile = () => harness.components.syncService.reconcile()

  const putDoc = (fileId: string, name: string, content: string) =>
    harness.drive.putDoc(fileId, {
      name,
      mimeType: GOOGLE_DOC_MIME_TYPE,
      content,
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })

  const readDoc = (driveFileId: string) => harness.components.repo.getDocByDriveFileId(driveFileId)

  it('files every doc a full load ingests under the shelf the model names', async () => {
    harness.llm.respondWith(
      respondByTitle({ 'צק ליסט משכורות': 'finance', 'נוהל פתיחת סניף': 'procedures' }),
    )
    putDoc('doc-pay', 'צק ליסט משכורות', 'תהליך חישוב המשכורות החודשי')
    putDoc('doc-open', 'נוהל פתיחת סניף', 'שלבי פתיחת סניף חדש')

    await reconcile()

    expect((await readDoc('doc-pay'))?.category).toBe('finance')
    expect((await readDoc('doc-open'))?.category).toBe('procedures')
  })

  it('a new doc authored later is filed by the next incremental sync — no manual step', async () => {
    await reconcile() // seed the cursor; the corpus is empty
    harness.llm.respondWith(respondByTitle({ 'דוח תדלוקים': 'reports' }))
    putDoc('doc-fuel', 'דוח תדלוקים - יולי', 'סיכום תדלוקים חודשי')

    await reconcile()

    expect((await readDoc('doc-fuel'))?.category).toBe('reports')
  })

  it('a content edit keeps the shelf and does not re-ask the model', async () => {
    putDoc('doc-1', 'נוהל קבלת סחורה', 'גרסה ראשונה')
    await reconcile()
    harness.llm.respondWith(() => ({ ok: true, content: 'menu' })) // would re-file if asked
    const asked = harness.llm.requests.length

    putDoc('doc-1', 'נוהל קבלת סחורה', 'גרסה שנייה, מעודכנת')
    await reconcile()

    expect((await readDoc('doc-1'))?.category).toBe('general')
    expect(harness.llm.requests.length).toBe(asked)
  })

  it('a rename puts the doc back in the filing queue and it lands on its new shelf', async () => {
    harness.llm.respondWith(
      respondByTitle({ 'רשימת ציוד': 'general', 'הסכם שכירות': 'agreements' }),
    )
    putDoc('doc-2', 'רשימת ציוד', 'תוכן קבוע')
    await reconcile()
    expect((await readDoc('doc-2'))?.category).toBe('general')

    putDoc('doc-2', 'הסכם שכירות סניף חדש', 'תוכן קבוע')
    await reconcile()

    expect((await readDoc('doc-2'))?.category).toBe('agreements')
  })

  it('a transport failure leaves the doc unfiled and the next pass retries it', async () => {
    putDoc('doc-3', 'צק ליסט ביטוח', 'פרטי ביטוח')
    harness.llm.failNext('provider responded 429')

    await reconcile()
    expect((await readDoc('doc-3'))?.category).toBeNull()
    expect(harness.categoryErrors).toEqual([
      { driveFileId: 'doc-3', error: 'provider responded 429' },
    ])

    harness.drive.putDoc('doc-3-sibling', {
      name: 'מסמך נוסף',
      mimeType: GOOGLE_DOC_MIME_TYPE,
      content: 'תוכן',
      modifiedTime: '2026-02-02T00:00:00.000Z',
    })
    await reconcile()

    expect((await readDoc('doc-3'))?.category).toBe('general')
  })

  it('a reply that is not a recognizable shelf lands on the general floor', async () => {
    harness.llm.respondWith(() => ({ ok: true, content: 'This document is about payroll.' }))
    putDoc('doc-4', 'מסמך שכר', 'תוכן')

    await reconcile()

    expect((await readDoc('doc-4'))?.category).toBe('general')
  })

  it('a skipped doc (scanned PDF) is still filed — by its title alone', async () => {
    harness.llm.respondWith(respondByTitle({ 'נוהל סרוק': 'procedures' }))
    harness.drive.putDoc('doc-scan', {
      name: 'נוהל סרוק',
      mimeType: PDF_MIME_TYPE,
      bytes: SCANNED_PDF,
      modifiedTime: '2026-02-01T00:00:00.000Z',
    })

    await reconcile()

    const doc = await readDoc('doc-scan')
    expect(doc?.status).toBe('skipped')
    expect(doc?.category).toBe('procedures')
  })

  it('grants each filing call a budget that clears the thinking allowance', async () => {
    // Thinking models spend their reasoning inside max_tokens (the openrouter preset allows
    // reasoningMaxTokens of it, as a hint the model may overrun). A budget at or below that
    // allowance starves the answer — every completion finishes empty or 'length' and the whole
    // corpus stays unfiled (observed live: all 37 docs failed at a 16-token budget).
    putDoc('doc-budget', 'מסמך כלשהו', 'תוכן')

    await reconcile()

    const thinkingAllowance = PROVIDER_PRESETS.openrouter.reasoningMaxTokens ?? 0
    expect(harness.llm.requests[0]?.maxTokens).toBeGreaterThan(thinkingAllowance)
  })

  it('a quiet pass re-asks nothing — filed docs stay out of the queue', async () => {
    putDoc('doc-5', 'נוהל כלשהו', 'תוכן')
    await reconcile()
    const asked = harness.llm.requests.length

    await reconcile()

    expect(harness.llm.requests.length).toBe(asked)
  })
})
