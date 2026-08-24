import type { Role } from '@burgers/shared'
import { type Department, type DocType, SENSITIVITIES, type Sensitivity } from '../db/schema.js'
import { keywordsOf } from './retrieval.js'

// Deterministic document classification: who a document belongs to, what kind of document it is,
// and who is allowed to read it — decided by rules, from the folder it sits in and the words in its
// filename, at sync time.
//
// Rules and not a model, deliberately. The Knowledge-tab shelf classifier is LLM-assigned and has
// already needed one fix; an inconsistent shelf is a cosmetic bug, an inconsistent access decision
// is a leak. Everything here is a pure function of two strings, so a document classifies the same
// way on every sync, is reproducible in a test, and is auditable by reading a list rather than by
// re-running a prompt.

// The access policy, in one table, owner-decided: lease and franchise terms are owner-level; payroll
// and staff hours are for whoever runs a branch and above; everything else is for everyone. This is
// the only place the policy is written down — retrieval reads it rather than restating it.
const ROLES_BY_SENSITIVITY: Record<Sensitivity, readonly Role[]> = {
  general: ['super_admin', 'admin', 'manager', 'employee'],
  internal: ['super_admin', 'admin', 'manager'],
  confidential: ['super_admin', 'admin'],
}

// The sensitivities a role may read — the shape a SQL `IN (...)` filter wants.
export function sensitivitiesVisibleTo(role: Role): Sensitivity[] {
  return SENSITIVITIES.filter((level) => ROLES_BY_SENSITIVITY[level].includes(role))
}

// A rule is a value plus the token groups that select it: it fires when EVERY token of ANY one
// group is present. Single-token groups are the common case; a two-token group exists so a word
// that is innocuous alone only counts in the company it is dangerous in.
interface Rule<T> {
  value: T
  any: readonly (readonly string[])[]
}

const matches = (tokens: ReadonlySet<string>, rule: Rule<unknown>): boolean =>
  rule.any.some((group) => group.every((token) => tokens.has(token)))

const firstMatch = <T>(tokens: ReadonlySet<string>, rules: readonly Rule<T>[]): T | null =>
  rules.find((rule) => matches(tokens, rule))?.value ?? null

// Ordered: the first rule that fires wins, so the list reads as its own precedence. Payroll before
// staff, because a salary checklist is finance's document even though it is about employees.
const DEPARTMENT_RULES: readonly Rule<Department>[] = [
  {
    value: 'property',
    any: [
      ['שכירות'],
      ['שכירויות'],
      ['זיכיון'],
      ['זיכיונות'],
      ['נכסים'],
      ['הסכם'],
      ['הסכמי'],
      ['הסכמים'],
      ['lease'],
      ['leases'],
      ['tenancy'],
      ['franchise'],
      ['agreements'],
    ],
  },
  {
    value: 'finance',
    any: [
      ['כספים'],
      ['משכורות'],
      ['משכורת'],
      ['שכר'],
      ['תלוש'],
      ['תלושי'],
      ['תדלוקים'],
      ['חשבונית'],
      ['חשבוניות'],
      ['finance'],
      ['payroll'],
      ['salary'],
      ['salaries'],
    ],
  },
  {
    value: 'hr',
    any: [
      ['עובד'],
      ['עובדת'],
      ['עובדים'],
      ['עובדי'],
      ['גיוס'],
      ['קליטת'],
      ['קליטה'],
      ['חגים'],
      ['הולדת'],
      ['employee'],
      ['employees'],
      ['hiring'],
      ['onboarding'],
    ],
  },
  {
    value: 'operations',
    any: [
      ['סניף'],
      ['סניפים'],
      ['תפעול'],
      ['מנה'],
      ['תפריט'],
      ['לחם'],
      ['הזמנות'],
      ['הזמנת'],
      ['ביטוח'],
      ['טיסה'],
      ['כשרות'],
      ['מכשרות'],
      ['branch'],
      ['menu'],
      ['kitchen'],
    ],
  },
  {
    value: 'office',
    any: [['מזכירת'], ['משרד'], ['רכש'], ['מסמכים'], ['סריקת'], ['office'], ['procurement']],
  },
]

const DOC_TYPE_RULES: readonly Rule<DocType>[] = [
  { value: 'checklist', any: [['ליסט'], ['checklist']] },
  { value: 'responsibilities', any: [['תחומי', 'אחריות'], ['responsibilities']] },
  {
    value: 'table',
    any: [['דשבורד'], ['מיפוי'], ['מעקב'], ['לוח'], ['dashboard'], ['mapping'], ['tracker']],
  },
  {
    value: 'procedure',
    any: [['נוהל'], ['נהלים'], ['תהליך'], ['תהליכי'], ['תהליכים'], ['procedure'], ['sop']],
  },
  { value: 'report', any: [['דוח'], ['דוחות'], ['report']] },
]

// Sensitivity is decided on its own keywords, never inferred from the department: most of HR is
// ordinary reading (a birthday procedure, a holiday checklist) and only the pay and hours documents
// inside it are restricted. Deriving one from the other would either lock HR shut or leave payroll
// open, and both are wrong.
//
// The lists are narrow on purpose. זכיינים (franchisees, the people) shares no token with זיכיון
// (a franchise, the right), so the franchisee-trip checklist stays readable while the franchise
// agreements do not — the kind of over-blocking that teaches staff the assistant is broken.
const SENSITIVITY_RULES: readonly Rule<Sensitivity>[] = [
  {
    value: 'confidential',
    any: [
      ['שכירות'],
      ['שכירויות'],
      ['זיכיון'],
      ['זיכיונות'],
      // The contract words, which carry the folder more than they carry any filename: the corpus's
      // own lease documents are already caught by שכירות above, and these are what make a folder
      // named הסכמים ונכסים protect a document called מסמך סופי.pdf. Nothing innocuous in the
      // corpus uses them, and erring toward owner-only for anything filed as an agreement is the
      // direction this feature should fail in.
      ['הסכם'],
      ['הסכמי'],
      ['הסכמים'],
      ['נכסים'],
      ['lease'],
      ['leases'],
      ['tenancy'],
      ['franchise'],
      ['agreements'],
    ],
  },
  {
    value: 'internal',
    any: [
      ['משכורות'],
      ['משכורת'],
      ['שכר'],
      ['תלוש'],
      ['תלושי'],
      ['כספים'],
      ['שעות', 'עובדים'],
      ['payroll'],
      ['salary'],
      ['salaries'],
      ['wages'],
    ],
  },
]

// Spreadsheets and HTML dashboards are tables whatever they are called: the corpus holds several
// whose filename says nothing about their shape, and the type is what later tells chunking to keep
// a row with its headers.
const TABULAR_MIME = /spreadsheet|excel|csv|html/i

// Ranked so a merge can take the stricter of two opinions without a lookup table.
const STRICTNESS: Record<Sensitivity, number> = { general: 0, internal: 1, confidential: 2 }
const stricter = (a: Sensitivity, b: Sensitivity): Sensitivity =>
  STRICTNESS[a] >= STRICTNESS[b] ? a : b

export interface DocumentMetadata {
  department: Department
  docType: DocType
  sensitivity: Sensitivity
}

export interface ClassifyDocumentInput {
  title: string
  // The name of the folder the document sits in, or null at the corpus root / when the adapter
  // could not resolve one.
  folderName: string | null
  sourceMimeType: string
}

// Classify one document. The folder wins on department, because a folder is a filing decision
// somebody made on purpose and a filename is whatever they typed that day. It cannot LOOSEN
// sensitivity, though: the two opinions merge to the stricter one, so a lease dropped in the
// operations folder is still owner-only, and a document in the leases folder stays owner-only even
// when its filename says nothing at all. That asymmetry is the point — a misfiled document should
// fail closed.
export function classifyDocument(input: ClassifyDocumentInput): DocumentMetadata {
  const titleTokens = new Set(keywordsOf(input.title))
  const folderTokens = new Set(input.folderName ? keywordsOf(input.folderName) : [])

  const department =
    firstMatch(folderTokens, DEPARTMENT_RULES) ??
    firstMatch(titleTokens, DEPARTMENT_RULES) ??
    'general'

  const docType =
    firstMatch(titleTokens, DOC_TYPE_RULES) ??
    (TABULAR_MIME.test(input.sourceMimeType) ? 'table' : 'reference')

  const sensitivity = stricter(
    firstMatch(folderTokens, SENSITIVITY_RULES) ?? 'general',
    firstMatch(titleTokens, SENSITIVITY_RULES) ?? 'general',
  )

  return { department, docType, sensitivity }
}
