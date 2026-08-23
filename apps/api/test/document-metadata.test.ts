import { describe, expect, it } from 'vitest'
import {
  type ClassifyDocumentInput,
  classifyDocument,
  sensitivitiesVisibleTo,
} from '../src/assistant/document-metadata.js'

// Classification decides who may read a document, so it is asserted against the CLIENT'S REAL
// FILENAMES rather than convenient synthetic ones. Every title below was read from their live Drive
// on 2026-08-18: thirty-two documents at the corpus root and five inside כספים. Synthetic strings
// would have passed while missing what the corpus actually contains — three spellings of "צ'ק
// ליסט", spreadsheets whose names say nothing about their shape, and one franchisee-trip checklist
// sitting one letter away from the franchise agreements it must NOT be locked away with.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const HTML = 'text/html'
const PDF = 'application/pdf'

const classify = (title: string, mime = DOCX, folderName: string | null = null) =>
  classifyDocument({ title, folderName, sourceMimeType: mime } satisfies ClassifyDocumentInput)

describe('classifyDocument — the live corpus', () => {
  it('locks the lease and franchise documents to the owner', () => {
    for (const [title, mime] of [
      ['דשבורד_הסכמי_שכירות (1).html', HTML],
      ['הסכמי_שכירות_רשת (1).pdf', PDF],
      ['מיפוי הסכמי זיכיון ושכירויות 2026.xlsx', XLSX],
    ] as const) {
      const result = classify(title, mime)
      expect(result.sensitivity, title).toBe('confidential')
      expect(result.department, title).toBe('property')
    }
  })

  it('restricts pay and hours to whoever runs a branch and above', () => {
    for (const title of [
      'שעות עובדים יולי.xlsx',
      'צק ליסט משכורות עובדי מטה-.docx',
      'צק ליסט משכורות-.docx',
      "צ'ק ליסט - שכר חודשי.docx",
      'מחלקת כספים- תהליכים חוזרים.docx',
    ]) {
      expect(classify(title, title.endsWith('.xlsx') ? XLSX : DOCX).sensitivity, title).toBe(
        'internal',
      )
    }
  })

  it('leaves the ordinary procedures readable by everyone', () => {
    for (const title of [
      'צק ליסט פתיחת סניף.docx',
      'נוהל יום הולדת עובד.docx',
      'צק ליסט חגים לעובדי המשרדים.docx',
      'תחומי אחריות.docx',
      'תהליכים חוזרים.docx',
      "צ'ק ליסט הכנסת מנה חדשה לתפריט.docx",
      'צק ליסט חידוש ביטוח רכב.docx',
      'צק ליסט הזמנת טיסה.docx',
    ]) {
      expect(classify(title).sensitivity, title).toBe('general')
    }
  })

  // The one that would quietly poison the whole feature. זכיינים (franchisees, the people) and
  // זיכיון (a franchise, the right) are different words that look alike, and a rule matching the
  // shape rather than the word would hide a trip checklist from every employee in the chain. That
  // kind of over-blocking is how staff learn the assistant is broken and stop asking it things.
  it('does not mistake a franchisee trip for a franchise agreement', () => {
    const result = classify('צק ליסט טיול זכיינים.docx')
    expect(result.sensitivity).toBe('general')
    expect(result.docType).toBe('checklist')
  })

  it('reads all three spellings of check-list as the same type', () => {
    for (const title of [
      'צק ליסט פתיחת סניף.docx',
      "צ'ק ליסט סריקת מסמכים ושמירה.docx",
      'צ׳ק ליסט - שכר חודשי.docx',
      'Ai ספר חברה צק ליסט.docx',
    ]) {
      expect(classify(title).docType, title).toBe('checklist')
    }
  })

  it('calls a spreadsheet or dashboard a table even when the name does not', () => {
    expect(classify('שעות עובדים יולי.xlsx', XLSX).docType).toBe('table')
    expect(classify('הזמנות_לחם_לחם_מעודכן.xlsx', XLSX).docType).toBe('table')
    expect(classify('דשבורד_מחלקות_שוטף.html', HTML).docType).toBe('table')
    expect(classify('מיפוי תהליכים חוזרים - תפעול.docx').docType).toBe('table')
  })

  it('files each document with the department that owns it', () => {
    expect(classify('צק ליסט פתיחת סניף.docx').department).toBe('operations')
    expect(classify('צק ליסט גיוס עובד חדש.-.docx').department).toBe('hr')
    expect(classify('תחומי אחריות מזכירת משרד ורכש.docx').department).toBe('office')
    expect(classify('דוח תדלוקים - יולי 2026 - בורגס בר המושבה (1).xlsx', XLSX).department).toBe(
      'finance',
    )
    expect(classify('מחלקות.docx').department).toBe('general')
  })

  // A payroll checklist is finance's document even though every word in it is about employees.
  it('gives payroll to finance rather than to HR', () => {
    expect(classify('צק ליסט משכורות עובדי מטה-.docx').department).toBe('finance')
  })

  it('recognises the responsibilities documents as their own kind', () => {
    expect(classify('תחומי אחריות.docx').docType).toBe('responsibilities')
    expect(classify('תחומי אחריות מזכירת משרד.docx').docType).toBe('responsibilities')
  })

  it('reads a procedure as a procedure', () => {
    expect(classify('נוהל יום הולדת עובד.docx').docType).toBe('procedure')
    expect(classify('תהליך חוזר -הכנסת מנה חדשה לתפריט.docx').docType).toBe('procedure')
    expect(classify('תהליכים חוזרים מזכירת משרד .docx').docType).toBe('procedure')
  })
})

describe('classifyDocument — the folder', () => {
  it('lets the folder decide the department a filename does not mention', () => {
    expect(classify('צק ליסט עובד חדש-.docx', DOCX, null).department).toBe('hr')
    expect(classify('צק ליסט עובד חדש-.docx', DOCX, 'כספים').department).toBe('finance')
  })

  // The asymmetry that makes the folder safe to trust: it can only ever tighten. A lease dragged
  // into the operations folder by mistake is still a lease.
  it('never lets a folder loosen a filename that says confidential', () => {
    expect(classify('הסכמי_שכירות_רשת.pdf', PDF, 'תפעול').sensitivity).toBe('confidential')
    expect(classify('צק ליסט משכורות-.docx', DOCX, 'תפעול').sensitivity).toBe('internal')
  })

  // The whole reason the folder is worth carrying: a lease saved under a meaningless name has no
  // keyword to catch, and only the folder can still say what it is.
  it('protects an anonymously-named document by the folder it sits in', () => {
    const result = classify('מסמך סופי 2026.pdf', PDF, 'הסכמים ונכסים')
    expect(result.sensitivity).toBe('confidential')
    expect(result.department).toBe('property')
  })

  it('treats the corpus root as no folder at all', () => {
    expect(classify('מחלקות.docx', DOCX, null).department).toBe('general')
    expect(classify('מחלקות.docx', DOCX, '').department).toBe('general')
  })
})

describe('sensitivitiesVisibleTo', () => {
  it('gives the owner everything', () => {
    expect(sensitivitiesVisibleTo('admin')).toEqual(['general', 'internal', 'confidential'])
  })

  it('gives a manager pay and hours but not the lease terms', () => {
    expect(sensitivitiesVisibleTo('manager')).toEqual(['general', 'internal'])
  })

  it('gives an employee the ordinary procedures only', () => {
    expect(sensitivitiesVisibleTo('employee')).toEqual(['general'])
  })

  it('lets the chain owner read every sensitivity', () => {
    // super_admin landed with the v2 design while this table was being written on another branch,
    // and was never added to it — leaving the chain's own owner able to read nothing at all.
    expect(sensitivitiesVisibleTo('super_admin')).toEqual(['general', 'internal', 'confidential'])
  })
})
