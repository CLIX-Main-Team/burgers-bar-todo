import type { Clock } from '../auth/clock.js'
import type { LlmClient } from './llm-client.js'
import {
  KNOWLEDGE_CATEGORIES,
  type KnowledgeCategory,
  type KnowledgeDoc,
  type KnowledgeRepository,
} from './repository.js'

// The categorizer that files every Knowledge Doc under one of the fixed Knowledge-tab shelves
// (ADR-0024). It runs after each reconcile pass over the docs whose category is still NULL —
// new files, renamed files, and any doc a previous pass failed on — so filing is decided once
// per doc and written to the cache, never recomputed per page view. The Drive corpus is one
// flat pile in practice, so the doc's own title and text are the filing signal; the Drive port
// stays parents-free (ADR-0023).
//
// Failure posture mirrors the sync it follows: best-effort per doc. A transport failure
// (timeout, 429, non-2xx — the LlmClient folds them all to ok:false) leaves the doc NULL, so
// the next pass retries it; a reply that is not a recognizable slug is stamped `general`, so a
// misbehaving model cannot wedge a doc into a permanent unfiled state. Neither ever throws out
// of categorizePending, and per ADR-0011 the report carries the error class only — never the
// title or content that made the prompt.

// How much of a doc's extracted text rides along as filing signal. Titles here are strongly
// descriptive; the excerpt just settles ambiguous ones, so a short head is plenty and keeps
// the per-doc call cheap.
const EXCERPT_CHARS = 500

// One slug is the whole desired completion; 16 tokens gives slack without inviting an essay.
const CATEGORIZE_MAX_TOKENS = 16

const SYSTEM_PROMPT = [
  'You file internal documents for a restaurant chain into exactly one category.',
  'The documents are mostly Hebrew: procedures, checklists, payroll and finance records,',
  'reports, rental agreements, and menu material.',
  'Reply with exactly one of these category slugs and nothing else:',
  `${KNOWLEDGE_CATEGORIES.join(', ')}.`,
  'procedures = operating procedures and checklists; finance = money, payroll, salaries,',
  'invoices, fuel and expense records; hr = hiring, onboarding, employee hours and welfare;',
  'reports = reports, tracking sheets and dashboards; agreements = leases, rentals and',
  'franchise contracts; menu = dishes, kitchen and menu changes; general = anything else.',
].join(' ')

export interface KnowledgeCategorizer {
  // File every uncategorized doc, best-effort per doc; resolves when the sweep is done.
  categorizePending(): Promise<void>
}

export interface KnowledgeCategorizerOptions {
  // Report one doc's failed filing (the error class only, ADR-0011). The running server passes
  // a logger, a test a collector; the doc stays NULL and the next sweep retries it.
  onCategoryError?: (driveFileId: string, error: string) => void
}

const isCategory = (value: string): value is KnowledgeCategory =>
  (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value)

export function createKnowledgeCategorizer(
  repo: KnowledgeRepository,
  llm: LlmClient,
  clock: Clock,
  options: KnowledgeCategorizerOptions = {},
): KnowledgeCategorizer {
  const reportError = options.onCategoryError ?? (() => {})

  const promptFor = (doc: KnowledgeDoc): string => {
    // A skipped doc has no extracted text; its title still files it (e.g. a scanned lease).
    const excerpt = doc.content?.slice(0, EXCERPT_CHARS)
    return excerpt ? `Title: ${doc.title}\n\nExcerpt:\n${excerpt}` : `Title: ${doc.title}`
  }

  const categorizeOne = async (doc: KnowledgeDoc): Promise<void> => {
    const result = await llm.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: promptFor(doc) },
      ],
      maxTokens: CATEGORIZE_MAX_TOKENS,
    })
    if (!result.ok) {
      reportError(doc.driveFileId, result.error)
      return
    }
    // Tolerate wrapping noise (case, quotes, a trailing period) but nothing looser: a reply
    // that is not one slug lands on the `general` floor rather than guessing a shelf.
    const reply = result.content.trim().toLowerCase().replace(/["'.]/g, '')
    await repo.setDocCategory(doc.driveFileId, isCategory(reply) ? reply : 'general', clock.now())
  }

  return {
    categorizePending: async () => {
      const pending = await repo.listUncategorizedDocs()
      for (const doc of pending) {
        try {
          await categorizeOne(doc)
        } catch (error) {
          reportError(doc.driveFileId, error instanceof Error ? error.name : 'unknown error')
        }
      }
    },
  }
}
