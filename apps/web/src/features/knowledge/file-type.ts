import type { KnowledgeDocSummary } from '@burgers/shared'
import type { IconRole } from '../../components/ui/icon-registry.js'

// How a document is marked. One channel, one fact — the same discipline project-look.ts applies
// to a project:
//
//   mark    — WHAT FORMAT the file is (glyph + ink, derived from its Drive mime type)
//   shelf   — WHERE it is filed (the categorizer's call, read as plain data)
//   date    — WHEN it last changed in Drive
//
// The format is the one thing a manager scanning forty rows sorts by eye, which is why it is the
// only place this screen spends colour: every row wore the same grey page glyph before (round 8),
// so the list read as texture rather than contents.
//
// Colour is never the only channel. The mark's glyph carries the format's letters inside the page
// silhouette, and the row prints the short format word beside the shelf name, so the type survives
// greyscale, colour blindness, and a screenshot in a chat.

export interface FileType {
  /** The registry role the mark draws. */
  icon: IconRole
  /** The short format word beside the shelf name on a row — the ABBR, not a localized string:
   *  PDF and XLSX are the same word in Hebrew, and a translated "PDF" would be wrong, not local. */
  abbr: string
  /** Tailwind classes for the mark: the type's ink on its own low-alpha ground (--filetype-*). */
  tone: string
}

// The formats the sync ingests (ADR-0023). An unsupported format never reaches this list — the
// sync leaves it out of the corpus entirely — so this map is the whole world, and GENERIC is here
// for the format added to the sync before it is given a mark of its own.
const GENERIC: FileType = {
  icon: 'file-generic',
  abbr: 'FILE',
  tone: 'bg-filetype-generic-soft text-filetype-generic',
}

const BY_MIME: Record<string, FileType> = {
  'application/vnd.google-apps.document': {
    icon: 'file-doc',
    abbr: 'DOC',
    tone: 'bg-filetype-doc-soft text-filetype-doc',
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    icon: 'file-doc',
    abbr: 'DOCX',
    tone: 'bg-filetype-doc-soft text-filetype-doc',
  },
  'application/pdf': {
    icon: 'file-pdf',
    abbr: 'PDF',
    tone: 'bg-filetype-pdf-soft text-filetype-pdf',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    icon: 'file-sheet',
    abbr: 'XLSX',
    tone: 'bg-filetype-sheet-soft text-filetype-sheet',
  },
  'text/html': {
    icon: 'file-web',
    abbr: 'HTML',
    tone: 'bg-filetype-web-soft text-filetype-web',
  },
}

export const fileTypeOf = (doc: KnowledgeDocSummary): FileType =>
  BY_MIME[doc.sourceMimeType] ?? GENERIC

// The distinct formats sitting on one shelf, commonest first — what the folder tile shows as a
// small row of marks beside its count. A folder that says only "12 documents" makes you open it to
// learn anything; one that says "12 documents, mostly spreadsheets" answers the question on the
// grid.
//
// Two is the cap, lowered from three when the marks grew in the scale-up pass: a third mark cost
// ~30px of the count line and clipped "3 documents" on the one shelf that has three formats. Two
// still reads as texture, and the count is the fact — the marks were never the number.
export function shelfTypes(docs: KnowledgeDocSummary[], limit = 2): FileType[] {
  const tally = new Map<IconRole, { type: FileType; count: number }>()
  for (const doc of docs) {
    const type = fileTypeOf(doc)
    const seen = tally.get(type.icon)
    if (seen) {
      seen.count += 1
    } else {
      tally.set(type.icon, { type, count: 1 })
    }
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.type)
}
