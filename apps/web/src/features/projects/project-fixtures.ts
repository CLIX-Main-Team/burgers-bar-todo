import type { TaskStatus } from '@burgers/shared'
import type { IconRole } from '../../components/ui/icon-registry.js'

// Sample projects for the Projects screen. There is no projects table, no endpoint and no
// write path yet — the owner's call was front-end first, backend later — so this file is the
// whole data layer, and the screen says so on its face rather than looking like a surface
// that lost its data.
//
// A project reuses the board's own TaskStatus rather than inventing a parallel vocabulary:
// it wears the same three dots and reads the same three words the lanes do, which is what
// makes the two screens feel like one app. When the real table lands it should keep that.
//
// Both languages are written here rather than run through the message catalogue: these are
// placeholder names, not app copy, and the catalogue should not carry rows that will be
// deleted the day the backend exists. The `kind` is the exception — it IS app copy, it comes
// from a closed set, so it lives in the catalogue like every other word on the screen.

// What kind of work a project is. A closed set on purpose: an open text field would give
// every branch its own vocabulary within a month, and the glyph could not be chosen from it.
export type ProjectKind = 'menu' | 'opening' | 'audit' | 'equipment' | 'training' | 'marketing'

export interface DemoProject {
  id: string
  kind: ProjectKind
  name: { en: string; he: string }
  // The branch a project belongs to, or null when it runs across the whole chain.
  branch: { en: string; he: string } | null
  owners: { en: string; he: string }[]
  done: number
  total: number
  status: TaskStatus
  // The day the chain expects this finished. Whole-day ISO, read in the reader's own local
  // day like every other date in the app (due-date.ts).
  targetDate: string
}

export const PROJECT_KIND_ICON: Record<ProjectKind, IconRole> = {
  menu: 'project-menu',
  opening: 'project-opening',
  audit: 'project-audit',
  equipment: 'project-equipment',
  training: 'project-training',
  marketing: 'project-marketing',
}

// The kind's word, mapped the same one-place way `labels.ts` maps the shared enums. It lives
// here rather than there because ProjectKind is this feature's own set, not a wire type — and
// keeping the glyph and the word side by side is what stops one of them being added without
// the other.
export function projectKindLabelKey(kind: ProjectKind): string {
  switch (kind) {
    case 'menu':
      return 'projects.kindMenu'
    case 'opening':
      return 'projects.kindOpening'
    case 'audit':
      return 'projects.kindAudit'
    case 'equipment':
      return 'projects.kindEquipment'
    case 'training':
      return 'projects.kindTraining'
    case 'marketing':
      return 'projects.kindMarketing'
  }
}

// A project's colour says WHAT KIND of work it is, the same thing its glyph says. That is
// double-encoding on purpose, and it is the opposite of what a person's avatar does: a person's
// tone is hashed from their name because a person is an individual, while projects come in a
// closed set of six kinds, and a manager scanning twenty of them wants to find all the audits —
// not to have memorised which arbitrary colour belongs to which project name.
//
// Two of the eight identity tones are deliberately unused here. Red already means destructive
// in this app and blue already means "you can click this"; spending either on a project kind
// would put a second meaning on a colour that has one.
//
// Grounds and inks are written out as whole class strings because Tailwind only ships the
// classes it can literally see in the source.
const KIND_TILE: Record<ProjectKind, string> = {
  menu: 'bg-person-3 text-person-3-ink', // amber
  opening: 'bg-person-4 text-person-4-ink', // green
  audit: 'bg-person-7 text-person-7-ink', // violet
  equipment: 'bg-person-5 text-person-5-ink', // teal
  training: 'bg-person-2 text-person-2-ink', // orange
  marketing: 'bg-person-8 text-person-8-ink', // pink
}

// The same six grounds without their ink, for the progress rail — the one large field of a
// project's colour on the card, and what makes a grid of them scannable.
const KIND_FILL: Record<ProjectKind, string> = {
  menu: 'bg-person-3',
  opening: 'bg-person-4',
  audit: 'bg-person-7',
  equipment: 'bg-person-5',
  training: 'bg-person-2',
  marketing: 'bg-person-8',
}

export function projectTile(project: DemoProject): string {
  return KIND_TILE[project.kind]
}

export function projectFill(project: DemoProject): string {
  return KIND_FILL[project.kind]
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'p1',
    kind: 'menu',
    name: { en: 'Winter menu rollout', he: 'השקת תפריט החורף' },
    branch: null,
    owners: [
      { en: 'Yael Bar', he: 'יעל בר' },
      { en: 'Amit Cohen', he: 'עמית כהן' },
    ],
    done: 8,
    total: 14,
    status: 'in_progress',
    targetDate: '2026-10-15',
  },
  {
    id: 'p2',
    kind: 'opening',
    name: { en: 'Ashdod Marina opening', he: 'פתיחת אשדוד מרינה' },
    branch: { en: 'Ashdod Marina', he: 'אשדוד מרינה' },
    owners: [{ en: 'Ori Mizrahi', he: 'אורי מזרחי' }],
    done: 3,
    total: 21,
    status: 'in_progress',
    targetDate: '2026-11-01',
  },
  {
    id: 'p3',
    kind: 'marketing',
    name: { en: 'End-of-summer campaign', he: 'קמפיין סוף הקיץ' },
    branch: null,
    owners: [
      { en: 'Amit Cohen', he: 'עמית כהן' },
      { en: 'Noa Levi', he: 'נועה לוי' },
    ],
    done: 11,
    total: 13,
    status: 'in_progress',
    targetDate: '2026-08-28',
  },
  {
    id: 'p4',
    kind: 'training',
    name: { en: 'Shift-lead training', he: 'הכשרת אחראי משמרת' },
    branch: { en: 'Dizengoff', he: 'דיזנגוף' },
    owners: [{ en: 'Noa Levi', he: 'נועה לוי' }],
    done: 5,
    total: 9,
    status: 'in_progress',
    targetDate: '2026-09-07',
  },
  {
    // The one behind: not started, and its target day is already past. It is in the fixtures
    // on purpose — a sample set where nothing is late never shows what late looks like.
    id: 'p5',
    kind: 'equipment',
    name: { en: 'Register upgrade', he: 'שדרוג הקופות' },
    branch: { en: 'Dizengoff', he: 'דיזנגוף' },
    owners: [{ en: 'Yael Bar', he: 'יעל בר' }],
    done: 0,
    total: 6,
    status: 'not_started',
    targetDate: '2026-08-18',
  },
  {
    id: 'p6',
    kind: 'audit',
    name: { en: 'Kashrut audit 2026', he: 'ביקורת כשרות 2026' },
    branch: null,
    owners: [{ en: 'Shahar Adler', he: 'שחר אדלר' }],
    done: 12,
    total: 12,
    status: 'done',
    targetDate: '2026-08-10',
  },
]

// A finished project reads 100% even if the counts were edited to disagree, and an empty one
// never divides by zero.
export function completionPercent(project: DemoProject): number {
  if (project.total === 0) return 0
  return Math.round((Math.min(project.done, project.total) / project.total) * 100)
}

// The reading order of the grid: anything still open comes before anything finished, and
// within each half the nearest target day leads. A manager opens this screen to find what
// needs them, and a finished project never does.
const STATUS_RANK: Record<TaskStatus, number> = { in_progress: 0, not_started: 1, done: 2 }

export function sortForBoard(projects: DemoProject[]): DemoProject[] {
  return [...projects].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.targetDate.localeCompare(b.targetDate),
  )
}

export function projectTotals(projects: DemoProject[]): { done: number; total: number } {
  return projects.reduce(
    (sum, project) => ({ done: sum.done + project.done, total: sum.total + project.total }),
    { done: 0, total: 0 },
  )
}
